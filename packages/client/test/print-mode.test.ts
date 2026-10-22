/**
 * The print mode, end to end.
 *
 * The client is a renderer, so a headless run is a run of the server that the client
 * prints the answer of. This test runs the server for real, with the deterministic model
 * of pi-ai (the faux provider), so a turn needs no network and no API key, and checks
 * that the client prints the answer of the model and exits.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { runPrintMode } from "../src/print-mode.ts";

/** The password the client and the server share. */
const PASSWORD = "print-mode-password";

/** The answer the deterministic model gives. */
const ANSWER = "The answer is 42.";

/** The provider of the deterministic model. */
const FAUX_PROVIDER = "faux";

/** The model of the deterministic model. */
const FAUX_MODEL = "faux-1";

const servers: PiServer[] = [];
const tempDirs: string[] = [];
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
 * A runtime factory that runs the deterministic model.
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
		const created = await createAgentSessionFromServices({ services, sessionManager, model });
		return { ...created, services, diagnostics: [] };
	};
}

/**
 * A server with the deterministic model, and a client of it.
 */
async function startFauxServer(): Promise<{ client: PiServerClient; sessionId: string }> {
	faux = registerFauxProvider({
		api: FAUX_PROVIDER,
		provider: FAUX_PROVIDER,
		models: [{ id: FAUX_MODEL, name: "Faux Model" }],
	});
	faux.setResponses([fauxAssistantMessage(ANSWER)]);

	const agentDir = makeTempDir("pi-print-agent-");
	const cwd = makeTempDir("pi-print-project-");
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
	const server = await startServer({
		port: 0,
		password: PASSWORD,
		agentDir,
		cwd,
		createRuntime: createFauxRuntimeFactory(),
		idleTimeoutMs: 0,
	});
	servers.push(server);

	const client = new PiServerClient({ url: server.url, password: PASSWORD });
	const snapshot = await client.openSession({ cwd });
	return { client, sessionId: snapshot.sessionId };
}

/**
 * The text the client printed.
 */
function printed(): string {
	return printedText.join("");
}

/** The text the client printed. */
const printedText: string[] = [];

afterEach(() => {
	printedText.length = 0;
});

afterAll(async () => {
	for (const server of servers.splice(0)) {
		await server.close();
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("the print mode", () => {
	test("prints the answer of the model and exits", async () => {
		const { client, sessionId } = await startFauxServer();
		const original = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			printedText.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		let exitCode: number;
		try {
			exitCode = await runPrintMode(client, sessionId, { mode: "text", messages: ["What is the answer?"] });
		} finally {
			process.stdout.write = original;
		}

		expect(printed()).toContain(ANSWER);
		expect(exitCode).toBe(0);
	});

	test("prints the events of the session in the json mode", async () => {
		const { client, sessionId } = await startFauxServer();
		const original = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			printedText.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		let exitCode: number;
		try {
			exitCode = await runPrintMode(client, sessionId, { mode: "json", messages: ["What is the answer?"] });
		} finally {
			process.stdout.write = original;
		}

		expect(exitCode).toBe(0);
		const events = printed()
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as { type: string });
		expect(events.some((event) => event.type === "agent_start")).toBe(true);
		expect(events.some((event) => event.type === "agent_settled")).toBe(true);
	});
});
