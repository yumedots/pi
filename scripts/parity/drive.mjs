import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServerProcess } from "./mock-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = process.env.PI_PARITY_OUT ?? join(HERE, "out");

export const PANE_WIDTH = 100;
export const PANE_HEIGHT = 30;

export const TMUX_SOCKET = "pi-parity";

export const PARITY_HOME = process.env.PI_PARITY_HOME ?? "/tmp/pi-parity";
export const WORK_DIR = join(PARITY_HOME, "work");
export const AGENT_DIR = join(PARITY_HOME, "agent");

export const SCENARIOS = {
	startup: [
		{ name: "booted", settle: 4000, virtualTime: 0 },
		// The typed text has to show up in the input box: that is the proof
		// that the input is live. A keystroke that arrives before the editor
		// is ready is lost, and the pane would keep the empty input box.
		{ name: "input focused", keys: ["hello world"], settle: 600, virtualTime: 2000, expect: /hello world/ },
	],
	panels: [
		{ name: "booted", settle: 4000, virtualTime: 0 },
		{ name: "help", keys: ["C-?"], settle: 800, virtualTime: 1000 },
		{ name: "help closed", keys: ["Escape"], settle: 600, virtualTime: 2000 },
		{ name: "models", keys: ["C-p"], settle: 1200, virtualTime: 3000 },
		{ name: "models closed", keys: ["Escape"], settle: 600, virtualTime: 4000 },
	],
	prompt: [
		{ name: "booted", settle: 4000, virtualTime: 0 },
		{ name: "answer", keys: ["hello world", "Enter"], settle: 4000, virtualTime: 2000, expect: /Hello from the parity mock\./ },
	],
	tool: [
		{ name: "booted", settle: 4000, virtualTime: 0 },
		{ name: "tool call", keys: ["read the fixture", "Enter"], settle: 4000, virtualTime: 2000 },
		{ name: "answer", settle: 4000, virtualTime: 8000, expect: /The fixture file says hello\./ },
	],
	thinking: [
		{ name: "booted", settle: 4000, virtualTime: 0 },
		{ name: "answer", keys: ["hello world", "Enter"], settle: 4000, virtualTime: 2000, expect: /Hello from the parity mock\./ },
	],
	markdown: [
		{ name: "booted", settle: 4000, virtualTime: 0 },
		{ name: "answer", keys: ["show me markdown", "Enter"], settle: 4000, virtualTime: 2000, expect: /E = mc²/ },
	],
	// The extension suite types once per extension, and a keystroke that
	// arrives before the editor is ready is lost: the run never happens and
	// the pane shows the startup screen. The boot settle is long enough for
	// the port to be up and taking keys.
	extension: [
		{ name: "booted", settle: 7000, virtualTime: 0 },
		{ name: "answer", keys: ["hello world", "Enter"], settle: 4000, virtualTime: 2000, expect: /Hello from the parity mock\./ },
	],
};

const MARKDOWN_REPLY = `# Parity Heading

A paragraph with **bold**, *italic*, ~~strikethrough~~ and \`code\`.

- first item
- second item
  - nested item

1. first
2. second

- [x] done
- [ ] todo

| Name | Value |
|------|-------|
| a    | 1     |
| bb   | 22    |

\`\`\`rust
fn main() {}
\`\`\`

A [link](https://example.com) and inline math $x^2$.

$$
E = mc^2
$$`;

export const MOCKS = {
	prompt: {
		turns: [{ type: "text", text: "Hello from the parity mock." }],
	},
	markdown: {
		turns: [{ type: "text", text: MARKDOWN_REPLY }],
	},
	tool: {
		turns: [
			{ type: "toolCall", name: "read", arguments: { path: "tool-input.txt" } },
			{ type: "text", text: "The fixture file says hello." },
		],
	},
	thinking: {
		turns: [
			{
				type: "thinking",
				thinking: "The parity mock thinks before it answers.",
				text: "Hello from the parity mock.",
			},
		],
	},
	// The extension suite's scenario: one prompt, one answer.
	extension: {
		turns: [{ type: "text", text: "Hello from the parity mock." }],
	},
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

function tmux(args, options = {}) {
	return execFileSync("tmux", ["-L", TMUX_SOCKET, ...args], { encoding: "utf8", ...options });
}

function killSession(session) {
	spawnSync("tmux", ["-L", TMUX_SOCKET, "kill-session", "-t", session], { stdio: "ignore" });
}

function readPane(session) {
	const pane = tmux(["capture-pane", "-p", "-t", session]);
	const lines = pane.split("\n");
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
	return lines;
}

function capture(session) {
	// The app paints in pieces (the logo, then the header, then the prompt) and repaints
	// while the logo animates, so a read can land between two of them. Read until two
	// reads a good while apart agree: that is the settled screen.
	let lines = readPane(session);
	for (let attempt = 0; attempt < 12; attempt++) {
		spawnSync("sleep", ["0.6"]);
		const next = readPane(session);
		if (next.join("\n") === lines.join("\n")) return next;
		lines = next;
	}
	return lines;
}

function startServer() {
	spawnSync("tmux", ["-L", TMUX_SOCKET, "new-session", "-d", "-s", "pi-parity-boot", "sleep", "600"], {
		stdio: "ignore",
	});
	tmux(["set-option", "-g", "extended-keys", "off"]);
	tmux(["set-option", "-g", "extended-keys-format", "xterm"]);
	killSession("pi-parity-boot");
}

export function gitCommit(dir) {
	try {
		return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	} catch {
		return "unknown";
	}
}

export function drive({ name, command, scenario, clock, meta }) {
	const steps = SCENARIOS[scenario];
	if (!steps) throw new Error(`unknown scenario: ${scenario}`);
	const session = `pi-parity-${name}-${process.pid}`;
	killSession(session);
	startServer();
	// The clock is frozen for the whole scenario. An animation reads it when it is
	// built, and the moment it is built is not deterministic, so a clock that moves
	// between the steps gives two runs of the same screen two different frames.
	// The animation's own frames are pinned by the Rust tests, which render at fixed
	// times, and by the 3dicon script, which renders the TypeScript original at the
	// same fixed times.
	if (clock) writeFileSync(clock, String(steps[0]?.virtualTime ?? 0));
	tmux(["new-session", "-d", "-s", session, "-x", String(PANE_WIDTH), "-y", String(PANE_HEIGHT), "sh", "-c", command]);
	const trace = { scenario, width: PANE_WIDTH, height: PANE_HEIGHT, meta: meta ?? {}, steps: [] };
	try {
		for (const step of steps) {
			const before = readPane(session);
			for (const key of step.keys ?? []) {
				tmux(["send-keys", "-t", session, key]);
			}
			if (step.keys?.length) {
				// The app may still be painting its startup screen, and the first
				// keystrokes can be lost while it does. A lost keystroke leaves the
				// pane exactly as it was, so the keys are sent again until the
				// screen changes — otherwise the scenario measures a run that
				// never happened and reports it as a match.
				for (let attempt = 0; attempt < 3; attempt++) {
					spawnSync("sleep", ["0.5"]);
					if (readPane(session).join("\n") !== before.join("\n")) break;
					for (const key of step.keys ?? []) {
						tmux(["send-keys", "-t", session, key]);
					}
				}
			}
			if (step.settle) spawnSync("sleep", [String(step.settle / 1000)]);
			trace.steps.push({ name: step.name, pane: capture(session) });
		}
	} finally {
		killSession(session);
	}
	return trace;
}

export function writeAgentDir(agentDir, baseUrl) {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "models.json"),
		`${JSON.stringify(
			{
				providers: {
					mock: {
						baseUrl,
						api: "openai-completions",
						apiKey: "parity-key",
						models: [
							{ id: "mock-1", name: "Mock Model", contextWindow: 128000, maxTokens: 4096 },
						],
					},
				},
			},
			null,
			1,
		)}\n`,
	);
	writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ threeDEmptySession: true }, null, 1)}\n`);
}

export function tsCommand({ tsRoot, cwd, agentDir, clock, extra = "" }) {
	return [
		`cd ${cwd} &&`,
		`PI_CODING_AGENT_DIR=${agentDir}`,
		`PI_PARITY_CLOCK=${clock}`,
		`bun --preload ${join(HERE, "clock-preload.mjs")} ${join(tsRoot, "packages/coding-agent/src/cli.ts")}`,
		`--offline --no-session --provider mock --model mock/mock-1${extra ? ` ${extra}` : ""}`,
	].join(" ");
}

export function rustCommand({ rustBin, cwd, agentDir, clock, extra = "" }) {
	return [
		`cd ${cwd} &&`,
		`PI_CODING_AGENT_DIR=${agentDir}`,
		`PI_PARITY_CLOCK=${clock}`,
		rustBin,
		`--offline --provider mock --model mock/mock-1 --api-key parity-key${extra ? ` ${extra}` : ""}`,
	].join(" ");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [side, scenario = "startup"] = process.argv.slice(2);
	const clock = join(OUT, "clock");
	mkdirSync(OUT, { recursive: true });
	writeFileSync(clock, "0");
	const tsRoot = process.env.PI_PARITY_TS_ROOT ?? ROOT;
	const agentDir = process.env.PI_PARITY_AGENT_DIR ?? AGENT_DIR;
	const cwd = process.env.PI_PARITY_CWD ?? WORK_DIR;
	const rustBin = process.env.PI_PARITY_RUST_BIN ?? join(ROOT, "rpi/target/debug/rpi");
	const mock = MOCKS[scenario] ? await startMockServerProcess(MOCKS[scenario]) : null;
	if (mock) writeAgentDir(agentDir, mock.baseUrl);
	const commands = {
		ts: tsCommand({ tsRoot, cwd, agentDir, clock }),
		rust: rustCommand({ rustBin, cwd, agentDir, clock }),
	};
	if (!commands[side]) throw new Error(`unknown side: ${side}`);
	try {
		const trace = drive({
			name: side,
			command: commands[side],
			scenario,
			clock,
			meta: { side, tsCommit: gitCommit(tsRoot), repoCommit: gitCommit(ROOT) },
		});
		const path = join(OUT, `${side}-${scenario}.json`);
		writeFileSync(path, `${JSON.stringify(trace, null, 1)}\n`);
		console.log(path);
	} finally {
		if (mock) await mock.close();
	}
}
