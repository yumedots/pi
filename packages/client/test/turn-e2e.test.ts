/**
 * A turn through the split, end to end.
 *
 * The server owns the agent runtime, the client owns the terminal UI, and the two live in
 * different processes. This test runs both of them for real:
 *
 * - the server runs in this process, with a runtime factory that gives it the deterministic
 *   model of pi-ai (the faux provider), so a turn needs no network and no API key;
 * - the client runs in a tmux pane, in its own process, with the real `InteractiveMode`
 *   driving a `RemoteSessionFacade` over HTTP and SSE.
 *
 * The prompt travels through the facade to the server, the server runs the agent, and the
 * answer has to appear on the screen of the pane. That is the whole claim of the split:
 * the client holds no agent runtime, yet the user sees the answer.
 *
 * The test cleans up after itself: the tmux session, the server and the temporary
 * directories.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	type FauxProviderRegistration,
	fauxAssistantMessage,
	registerFauxProvider,
} from "@earendil-works/pi-ai/compat";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { type PiServer, startServer } from "@earendil-works/pi-server";
import { PiServerClient } from "@earendil-works/pi-server/client";
import { afterAll, describe, expect, test } from "vitest";
import { RemoteSessionFacade } from "../src/remote-facade.ts";

/** The root of the repository, three levels above this file. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The tmux socket the test uses.
 *
 * A socket of its own keeps the session alive when something else on the machine kills the
 * default tmux server.
 */
const TMUX_SOCKET = `pi-turn-e2e-${process.pid}`;

/** The tmux session the client runs in. */
const TMUX_SESSION = "turn-e2e";

/** The password the client and the server share. */
const PASSWORD = "turn-e2e-password";

/** The question the test asks. */
const QUESTION = "What is the answer?";

/** The answer the deterministic model gives. */
const ANSWER = "The answer is 42.";

/** The provider of the deterministic model. */
const FAUX_PROVIDER = "faux";

/** The model of the deterministic model. */
const FAUX_MODEL = "faux-1";

/** How long the pane is waited for, in milliseconds. */
const WAIT_TIMEOUT_MS = 60_000;

/** How often the pane is polled, in milliseconds. */
const POLL_INTERVAL_MS = 200;

/** The width of the pane. */
const PANE_WIDTH = 120;

/** The height of the pane. */
const PANE_HEIGHT = 40;

/** The directories the test cleans up. */
const tempDirs: string[] = [];

/** The servers the test closes. */
const servers: PiServer[] = [];

/** The deterministic model the test registers. */
let faux: FauxProviderRegistration | undefined;

/**
 * A temporary directory that is removed when the test ends.
 */
function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/**
 * Run a tmux command on the socket of the test.
 *
 * A command that fails is not fatal when the caller says so: the socket of the test does
 * not exist before the first session and after the cleanup.
 */
function tmux(args: string[], allowFailure = false): string {
	try {
		return execFileSync("tmux", ["-L", TMUX_SOCKET, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		if (allowFailure) return "";
		throw error;
	}
}

/**
 * The text of the pane.
 */
function capturePane(): string {
	return tmux(["capture-pane", "-p", "-t", TMUX_SESSION]);
}

/**
 * Wait for a while.
 *
 * The test drives a real terminal, so the wait is a real wait: the screen is polled until
 * it shows what the test waits for. Fake timers cannot help here, because the thing that
 * draws is another process, whose clock this test does not control.
 */
async function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	await promise;
}

/**
 * Wait until the pane matches a predicate.
 *
 * @returns The screen that matched.
 */
async function waitForPane(description: string, predicate: (pane: string) => boolean): Promise<string> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const pane = capturePane();
		if (pane.length > 0 && predicate(pane)) return pane;
		await delay(POLL_INTERVAL_MS);
	}
	throw new Error(`The pane never showed ${description}. The screen was:\n${capturePane()}`);
}

/**
 * Wait until a condition holds.
 */
async function waitFor(description: string, predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await delay(POLL_INTERVAL_MS);
	}
	throw new Error(`The condition never held: ${description}`);
}

/**
 * The agent directory of the run: the settings, the model catalog and the sessions.
 *
 * The catalog describes the faux provider, so the client and the server agree on the model
 * of the session without anybody logging in.
 */
function writeAgentDir(): string {
	const agentDir = makeTempDir("pi-turn-e2e-agent-");
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				[FAUX_PROVIDER]: {
					baseUrl: "http://localhost:0",
					apiKey: "faux-key",
					api: FAUX_PROVIDER,
					models: [
						{
							id: FAUX_MODEL,
							name: "Faux Model",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 128000,
							maxTokens: 4096,
						},
					],
				},
			},
		}),
	);
	return agentDir;
}

/**
 * The runtime factory of the server: a session whose model is the deterministic one.
 *
 * The factory reads the model catalog of the agent directory, so the model of the session
 * is the one the client sees.
 */
function createFauxRuntimeFactory(): CreateAgentSessionRuntimeFactory {
	return async ({ cwd, agentDir, sessionManager }) => {
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			allowModelNetwork: false,
		});
		const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime });
		const model = modelRuntime.getModel(FAUX_PROVIDER, FAUX_MODEL);
		expect(model, "the faux model is in the catalog of the agent directory").toBeDefined();
		const created = await createAgentSessionFromServices({ services, sessionManager, model });
		return { ...created, services, diagnostics: [] };
	};
}

/**
 * The driver of the client: the real terminal UI on top of the real facade.
 *
 * It runs in its own process, so the pane holds a client that cannot run an agent: every
 * turn it shows comes from the server. The driver writes its process id down, so the test
 * can prove that the screen came from another process than the one that ran the agent.
 */
function writeDriverScript(dir: string): string {
	const path = join(dir, "client-driver.ts");
	writeFileSync(
		path,
		[
			`import { writeFileSync } from "node:fs";`,
			`import { InteractiveMode } from ${JSON.stringify(join(REPO_ROOT, "packages/client/src/interactive-mode.ts"))};`,
			`import { RemoteSessionFacade } from ${JSON.stringify(join(REPO_ROOT, "packages/client/src/remote-facade.ts"))};`,
			`import { PiServerClient } from ${JSON.stringify(join(REPO_ROOT, "packages/server/src/client.ts"))};`,
			"",
			"const [url, password, sessionId, cwd, agentDir, pidFile] = process.argv.slice(2);",
			"writeFileSync(pidFile, String(process.pid));",
			"const client = new PiServerClient({ url, password });",
			"const facade = new RemoteSessionFacade(client, sessionId, cwd, { agentDir });",
			"await facade.load();",
			"const mode = new InteractiveMode(facade, {});",
			"await mode.run();",
			"",
		].join("\n"),
	);
	// The driver runs outside the repository, so it needs the workspace paths of the
	// repository to import the packages from their sources instead of their builds.
	writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: join(REPO_ROOT, "tsconfig.json") }));
	return path;
}

/**
 * The text of the last assistant message of a transcript.
 */
function lastAssistantText(messages: readonly AgentMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message || message.role !== "assistant" || !("content" in message)) continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		return content
			.filter((part): part is { type: "text"; text: string } => {
				const block = part as { type?: string; text?: string };
				return block.type === "text" && typeof block.text === "string";
			})
			.map((part) => part.text)
			.join("");
	}
	return "";
}

describe("a turn through the split", () => {
	afterAll(async () => {
		tmux(["kill-session", "-t", TMUX_SESSION], true);
		faux?.unregister();
		faux = undefined;
		for (const server of servers.splice(0)) {
			await server.close();
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the screen of the client shows the answer the server produced", async () => {
		const agentDir = writeAgentDir();
		const projectDir = makeTempDir("pi-turn-e2e-project-");

		// The deterministic model: the server answers with it, without a network. The api
		// id is fixed, so it is the one the catalog of the agent directory names.
		faux = registerFauxProvider({
			api: FAUX_PROVIDER,
			provider: FAUX_PROVIDER,
			models: [{ id: FAUX_MODEL, name: "Faux Model" }],
		});
		faux.setResponses([fauxAssistantMessage(ANSWER)]);

		const server = await startServer({
			port: 0,
			password: PASSWORD,
			agentDir,
			cwd: projectDir,
			createRuntime: createFauxRuntimeFactory(),
			// The watchdog would close the server while the test is still watching it.
			idleTimeoutMs: 0,
		});
		servers.push(server);

		const client = new PiServerClient({ url: server.url, password: PASSWORD });
		const snapshot = await client.openSession({ cwd: projectDir });
		expect(snapshot.sessionId).toEqual(expect.any(String));
		expect(snapshot.model).toBe(`${FAUX_PROVIDER}/${FAUX_MODEL}`);

		// The client runs in its own process, in a pane of its own.
		const driverDir = makeTempDir("pi-turn-e2e-driver-");
		const driver = writeDriverScript(driverDir);
		const pidFile = join(driverDir, "client.pid");
		tmux(["kill-session", "-t", TMUX_SESSION], true);
		tmux([
			"new-session",
			"-d",
			"-s",
			TMUX_SESSION,
			"-x",
			String(PANE_WIDTH),
			"-y",
			String(PANE_HEIGHT),
			"-c",
			projectDir,
			[
				"PI_OFFLINE=1",
				`bun ${driver}`,
				server.url,
				PASSWORD,
				snapshot.sessionId,
				projectDir,
				agentDir,
				pidFile,
			].join(" "),
		]);

		try {
			// The client is up when it draws its prompt.
			await waitForPane(
				"the prompt of the client",
				(pane) => /^\s*>\s*$/m.test(pane) && pane.includes("ctrl+c twice to exit"),
			);

			// The screen came from another process than the one that owns the agent.
			await waitFor("the pid of the client", () => existsSync(pidFile));
			const clientPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
			expect(clientPid).toBeGreaterThan(0);
			expect(clientPid).not.toBe(server.pid);

			// The prompt goes through the facade of the client, so it travels over HTTP
			// to the server, which runs the agent.
			const facade = new RemoteSessionFacade(client, snapshot.sessionId, projectDir, { agentDir });
			await facade.load();
			const events: string[] = [];
			facade.subscribe((event) => events.push(event.type));
			const disposition = await facade.prompt(QUESTION);
			expect(disposition).toBe("started");

			// The answer has to reach the screen of the client.
			const pane = await waitForPane(
				"the turn on the screen",
				(screen) => screen.includes(QUESTION) && screen.includes(ANSWER),
			);

			// The question and the answer are both on the screen: the client shows the
			// messages of the session it does not own.
			expect(pane).toContain(QUESTION);
			expect(pane).toContain(ANSWER);

			// The client learned about the turn over the event stream of the server.
			await waitFor("the settled event of the turn", () => events.includes("agent_settled"));
			expect(events).toContain("agent_start");
			expect(events).toContain("agent_settled");

			// The server wrote the turn to the session file, so the answer is durable and
			// not only drawn.
			const sessionFile = snapshot.sessionFile;
			expect(sessionFile, "the session has a file").toBeDefined();
			const transcript = readFileSync(sessionFile as string, "utf8");
			expect(transcript).toContain(QUESTION);
			expect(transcript).toContain(ANSWER);

			// The transcript the client fetched from the server holds the same answer.
			await facade.refresh();
			expect(lastAssistantText(facade.messages)).toBe(ANSWER);

			facade.dispose();
		} finally {
			tmux(["kill-session", "-t", TMUX_SESSION], true);
			faux?.unregister();
			faux = undefined;
		}
	}, 180_000);
});
