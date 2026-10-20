import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const PANE_WIDTH = 100;
export const PANE_HEIGHT = 30;
export const TMUX_SOCKET = "pi-screens";

export const TS_ROOT = process.env.PI_SCREENS_TS_ROOT ?? "/Users/gabriel/pi";
export const RUST_ROOT = process.env.PI_SCREENS_RUST_ROOT ?? "/Users/gabriel/pi-native";
export const RUST_BIN = process.env.PI_SCREENS_RUST_BIN ?? join(RUST_ROOT, "rpi/target/debug/rpi");
export const SCRATCH = process.env.PI_SCREENS_SCRATCH ?? "/tmp/pi-screens";

export function tmux(args, options = {}) {
	return execFileSync("tmux", ["-L", TMUX_SOCKET, ...args], { encoding: "utf8", ...options });
}

export function killSession(session) {
	spawnSync("tmux", ["-L", TMUX_SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
}

export function readPane(session) {
	const pane = tmux(["capture-pane", "-p", "-t", session]);
	const lines = pane.split("\n");
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
	return lines;
}

/**
 * The app paints in pieces, so a read can land between two of them. Read until two
 * reads a good while apart agree: that is the settled screen.
 */
export function capture(session) {
	let lines = readPane(session);
	for (let attempt = 0; attempt < 14; attempt++) {
		spawnSync("sleep", ["0.7"]);
		const next = readPane(session);
		if (next.join("\n") === lines.join("\n")) return next;
		lines = next;
	}
	return lines;
}

export function sleep(seconds) {
	spawnSync("sleep", [String(seconds)]);
}

export function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function tsCommand({ home, agentDir, clock, args = [], agentDirEnv = true, withSession = false }) {
	return [
		`HOME=${shellQuote(home)}`,
		agentDirEnv ? `PI_CODING_AGENT_DIR=${shellQuote(agentDir)}` : "",
		`PI_PARITY_CLOCK=${shellQuote(clock)}`,
		`bun --preload ${shellQuote(join(PARITY_DIR, "clock-preload.mjs"))}`,
		`${shellQuote(join(TS_ROOT, "packages/coding-agent/src/cli.ts"))}`,
		`--offline`,
		withSession ? "" : "--no-session",
		`--provider mock --model mock/mock-1`,
		...args,
	].join(" ");
}

export const PARITY_DIR = join(HERE, "..");

export function rustCommand({ home, agentDir, clock, args = [], agentDirEnv = true, withSession = false }) {
	return [
		`HOME=${shellQuote(home)}`,
		agentDirEnv ? `PI_CODING_AGENT_DIR=${shellQuote(agentDir)}` : "",
		`PI_PARITY_CLOCK=${shellQuote(clock)}`,
		`${shellQuote(RUST_BIN)}`,
		`--offline`,
		withSession ? "" : "--no-session",
		`--provider mock --model mock/mock-1 --api-key parity-key`,
		...args,
	].join(" ");
}

/**
 * Runs one screen on one side and returns the pane text of the requested step.
 * `spec.setup` prepares the work dir and the agent dir; `spec.steps` are the
 * keystroke steps; `spec.capture` names the step whose pane is the screen.
 */
export function runScreen({ side, spec, mockBaseUrl }) {
	const session = `pi-screens-${side}-${spec.name}`;
	killSession(session);
	const home = join(SCRATCH, "home", side, spec.name);
	const agentDir = join(SCRATCH, "agent", side, spec.name);
	const workDir = join(SCRATCH, "work", side, spec.name);
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(home, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(workDir, { recursive: true });

	const models = {
		providers: {
			mock: {
				baseUrl: mockBaseUrl ?? "http://127.0.0.1:9/v1",
				api: "openai-completions",
				apiKey: "parity-key",
				models: spec.noModels
					? []
					: [{ id: "mock-1", name: "Mock Model", contextWindow: 128000, maxTokens: 4096 }],
			},
		},
	};
	if (spec.noAgentDir) {
		// The first-run screen needs the default agent dir (the original refuses
		// to run its setup when the agent dir is overridden), and that dir must
		// have a model but no settings.json.
		const defaultAgentDir = join(home, ".pi", "agent");
		mkdirSync(defaultAgentDir, { recursive: true });
		writeFileSync(join(defaultAgentDir, "models.json"), `${JSON.stringify(models, null, 1)}\n`);
	} else {
		writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(models, null, 1)}\n`);
		writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(spec.settings ?? {}, null, 1)}\n`);
	}

	if (spec.setup) spec.setup({ workDir, agentDir, home });

	const clock = join(SCRATCH, "clock");
	writeFileSync(clock, "0");

	const env = spec.env ?? {};
	const envPrefix = Object.entries(env)
		.map(([key, value]) => `${key}=${shellQuote(String(value))}`)
		.join(" ");
	const args = spec.args ?? [];
	const base = side === "ts" ? tsCommand : rustCommand;
	const command = [
		`cd ${shellQuote(workDir)} &&`,
		envPrefix ? `env ${envPrefix}` : "",
		base({ home, agentDir, clock, args, agentDirEnv: !spec.noAgentDir, withSession: spec.session === true }),
	]
		.filter(Boolean)
		.join(" ");

	const trace = [];
	if (spec.direct) {
		// The app never opens a TUI on this screen (it exits with an error), so the
		// screen is whatever it printed on the terminal.
		const result = spawnSync("sh", ["-c", command], { encoding: "utf8", timeout: 30000 });
		const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
		const pane = text.split("\n");
		while (pane.length > 0 && pane[pane.length - 1].trim() === "") pane.pop();
		return { pane, trace, command, session };
	}
	// The app can exit on its own (no models available, a fatal startup error).
	// Keep the last pane that was readable so the screen is still captured.
	let lastPane = [];
	const read = () => {
		try {
			lastPane = readPane(session);
		} catch {
			// The session is gone; the last readable pane stands.
		}
		return lastPane;
	};
	try {
		tmux(["new-session", "-d", "-s", session, "-x", String(PANE_WIDTH), "-y", String(PANE_HEIGHT), "sh", "-c", command]);
		// The app needs a few seconds to mount the TUI and register its key handlers
		// before a keystroke means anything.
		sleep((spec.boot ?? 9000) / 1000);
		read();
		const steps = spec.stepsBySide?.[side] ?? spec.steps;
		for (const step of steps) {
			for (const key of step.keys ?? []) {
				try {
					tmux(["send-keys", "-t", session, key]);
				} catch {
					// The app already exited; nothing to type at.
				}
			}
			sleep((step.settle ?? 1200) / 1000);
			trace.push({ name: step.name, keys: step.keys ?? [], pane: read() });
		}
		const wanted = spec.capture ?? steps[steps.length - 1].name;
		const found = trace.find((entry) => entry.name === wanted);
		const pane = found ? found.pane : read();
		return { pane, trace, command, session };
	} finally {
		killSession(session);
	}
}

export function writeScreen(side, name, pane, meta) {
	const dir = join(HERE, side);
	mkdirSync(dir, { recursive: true });
	const header = [
		`# screen: ${name}`,
		`# side: ${side}`,
		`# command: ${meta.command}`,
		`# keys: ${meta.keys}`,
		`# note: ${meta.note ?? ""}`,
	].join("\n");
	writeFileSync(join(dir, `${name}.txt`), `${header}\n\n${pane.join("\n")}\n`);
}
