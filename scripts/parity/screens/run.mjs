#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServerProcess } from "../mock-server.mjs";
import { runScreen, writeScreen, killSession, tmux } from "./harness.mjs";
import { SCREENS, MOCKS } from "./screens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const sideArg = argv.find((arg) => arg === "ts" || arg === "rust");
const only = argv.filter((arg) => arg !== "ts" && arg !== "rust");
const sides = sideArg ? [sideArg] : ["ts", "rust"];

function tmuxOptions() {
	try {
		tmux(["new-session", "-d", "-s", "pi-screens-boot", "sleep", "30"]);
	} catch {
		// The socket may already be up; the options below are what matter.
	}
	try {
		tmux(["set-option", "-g", "extended-keys", "off"]);
		tmux(["set-option", "-g", "extended-keys-format", "xterm"]);
	} catch {
		// The socket may not exist yet; the first new-session creates it.
	}
	killSession("pi-screens-boot");
}

const results = [];

mkdirSync(join(HERE, "out"), { recursive: true });
tmuxOptions();

for (const side of sides) {
	for (const spec of SCREENS) {
		if (only.length > 0 && !only.includes(spec.name)) continue;
		if (spec.unreachable) {
			console.log(`${side} ${spec.name}: not reachable - ${spec.unreachable}`);
			continue;
		}
		// The mock runs in its own process: the driver blocks the event loop while
		// it talks to tmux, and an in-process server could not answer the app.
		let mock = null;
		let mockBaseUrl = null;
		if (spec.mock) {
			mock = await startMockServerProcess(MOCKS[spec.mock]);
			mockBaseUrl = mock.baseUrl;
		}
		const keyPath = [];
		for (const step of spec.steps) {
			for (const key of step.keys ?? []) keyPath.push(key);
		}
		const meta = {
			command: "(see scripts/parity/screens/harness.mjs)",
			keys: keyPath.length > 0 ? keyPath.join(" ") : "(none)",
			note: spec.note ?? "",
		};
		try {
			const result = runScreen({ side, spec, mockBaseUrl });
			meta.command = result.command;
			writeScreen(side, spec.name, result.pane, meta);
			results.push({ side, name: spec.name, ok: true, lines: result.pane.length });
			console.log(`${side} ${spec.name}: ${result.pane.length} lines`);
		} catch (error) {
			results.push({ side, name: spec.name, ok: false, error: String(error) });
			console.log(`${side} ${spec.name}: FAILED ${String(error)}`);
		} finally {
			if (mock) await mock.close();
		}
	}
}

writeFileSync(join(HERE, "out", "results.json"), `${JSON.stringify(results, null, 1)}\n`);
