import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const clientName = "@earendil-works/pi-client";

/**
 * Smoke-test the client package: its public entry and its `pi` binary.
 */
export function smokeTestClient(directory, runtime = process.execPath) {
	const packageDir = join(directory, "node_modules", clientName);
	const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	// The client is the package that ships the `pi` binary.
	if (!manifest.bin?.pi) throw new Error(`${clientName} must ship the pi binary`);
	const home = mkdtempSync(join(tmpdir(), "pi-client-smoke-home-"));
	const entry = join(directory, "client-smoke.mjs");
	const env = {
		PATH: process.env.PATH,
		HOME: home,
		USERPROFILE: home,
		APPDATA: home,
		LOCALAPPDATA: home,
		XDG_CONFIG_HOME: home,
		XDG_CACHE_HOME: home,
		PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
		PI_OFFLINE: "1",
	};
	for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
		if (process.env[name]) env[name] = process.env[name];
	}
	try {
		writeFileSync(
			entry,
			`import assert from "node:assert/strict";
import { startServer } from "@earendil-works/pi-server";
import { PiServerClient } from "@earendil-works/pi-server/client";
assert.equal(typeof startServer, "function");
assert.equal(typeof PiServerClient, "function");
`,
		);
		execFileSync(runtime, [entry], { cwd: directory, env, stdio: ["inherit", "pipe", "pipe"], timeout: 30_000 });
		for (const cli of new Set([manifest.bin.pi, "dist/cli.js"])) {
			const output = execFileSync(runtime, [join(packageDir, cli), "--version"], {
				cwd: directory,
				encoding: "utf8",
				env,
				stdio: ["inherit", "pipe", "pipe"],
				timeout: 30_000,
			});
			if (output.trim() !== manifest.version) throw new Error(`Unexpected version from ${cli}: ${output}`);
		}
	} finally {
		rmSync(entry, { force: true });
		rmSync(home, { recursive: true, force: true });
	}
	console.log(`Client policy smoke tests passed (${runtime}).`);
}
