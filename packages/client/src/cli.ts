#!/usr/bin/env node
/**
 * The client entry point.
 *
 * The client is the pi terminal UI. It never hosts the agent runtime: it drives a pi
 * server over HTTP and SSE. This module wires the command line to that server: the
 * subcommands that manage the server process, and the interactive mode that drives a
 * session on it.
 */

import { randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
	type CreateAgentSessionRuntimeFactory,
	createRuntimeFactory,
	getAgentDir,
	type InteractiveStartContext,
	main,
	ProjectTrustStore,
	parseArgs,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { setConfigSelector } from "@earendil-works/pi-coding-agent/cli/config-selector-host";
import type { SessionStateSnapshot } from "@earendil-works/pi-server";
import { basicAuthHeader, createPairingCode, startServer } from "@earendil-works/pi-server";
import { PiServerClient } from "@earendil-works/pi-server/client";
import { RemoteSessionFacade } from "./remote-facade.ts";
import { ensureServer, isServerAlive, readServerRegistration } from "./server-launcher.ts";

/** The command that starts a server process. */
export const SERVER_COMMAND = "pi-server";

/**
 * The flag the bundle build defines. It tells the entry point that it is the process
 * entry, even when the bundle launcher is the file the user ran.
 */
declare const PI_BUNDLED_NODE: boolean | undefined;

/**
 * Run the client.
 *
 * The subcommands manage the server; everything else is the interactive client.
 */
export async function runClient(args: string[]): Promise<void> {
	const [command, ...rest] = args;
	switch (command) {
		case "serve":
			await runServe(rest);
			return;
		case "pair":
			await runPair(rest);
			return;
		case "service":
			await runService(rest);
			return;
		default:
			break;
	}
	registerConfigEditor();
	await main(args, { onInteractive: startInteractive });
}

/**
 * Register the interactive config editor with the coding agent.
 *
 * The editor is a terminal UI, so it is loaded when the command runs, not at startup.
 */
function registerConfigEditor(): void {
	setConfigSelector(async (options) => {
		const { selectConfig } = await import("./cli/config-selector.ts");
		await selectConfig(options);
	});
}

/**
 * Start the server in the foreground and stay alive until the process is asked to stop.
 */
async function runServe(args: string[]): Promise<void> {
	const flags = parseFlags(args);
	const agentDir = stringFlag(flags, "agent-dir") ?? getAgentDir();
	const cwd = process.cwd();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const password = stringFlag(flags, "password") ?? randomBytes(16).toString("base64url");
	const port = numberFlag(flags, "port") ?? settingsManager.getServerPort();
	const hostname = stringFlag(flags, "hostname") ?? settingsManager.getServerHostname();
	const idleTimeoutMs = numberFlag(flags, "idle-timeout-ms") ?? settingsManager.getServerIdleTimeoutMs();

	const exited = Promise.withResolvers<void>();

	const server = await startServer({
		hostname,
		port,
		password,
		agentDir,
		cwd,
		idleTimeoutMs,
		createRuntime: createServerRuntimeFactory(agentDir, settingsManager),
		onIdle: () => exited.resolve(),
	});

	console.log(`server listening on ${server.url}`);
	console.log(`server password ${password}`);

	await Promise.race([exited.promise, waitForSignal()]);
	await server.close();
}

/**
 * Print the LAN url, a pairing code and the url that redeems it.
 */
async function runPair(args: string[]): Promise<void> {
	const flags = parseFlags(args);
	const agentDir = stringFlag(flags, "agent-dir") ?? getAgentDir();
	const registration = readServerRegistration(agentDir);
	if (!registration) {
		throw new Error(`No pi server is registered for ${agentDir}. Start one with "${SERVER_COMMAND}".`);
	}
	if (!(await isServerAlive(registration))) {
		throw new Error(`The registered pi server (pid ${registration.pid}) is not running.`);
	}
	const code = await requestPairingCode(registration.url);
	const url = lanUrlFor(registration.url);
	console.log(`LAN url: ${url}`);
	console.log(`pairing code: ${code}`);
	console.log(`open: ${url}/auth/connect/${code}`);
}

/**
 * Report on the registered server, or stop it.
 */
async function runService(args: string[]): Promise<void> {
	const [action, ...rest] = args;
	const flags = parseFlags(rest);
	const agentDir = stringFlag(flags, "agent-dir") ?? getAgentDir();
	const registration = readServerRegistration(agentDir);
	if (!registration) {
		console.log(`No pi server is registered for ${agentDir}.`);
		return;
	}
	if (action === "stop") {
		try {
			process.kill(registration.pid, "SIGTERM");
		} catch (error) {
			throw new Error(`The pi server (pid ${registration.pid}) could not be stopped: ${describe(error)}`);
		}
		console.log(`Sent SIGTERM to the pi server (pid ${registration.pid}).`);
		return;
	}
	if (action !== undefined && action !== "status") {
		console.log("Usage: pi service [status|stop]");
		return;
	}
	const alive = await isServerAlive(registration);
	console.log(`url: ${registration.url}`);
	console.log(`pid: ${registration.pid}`);
	console.log(`alive: ${alive ? "yes" : "no"}`);
}

/**
 * The interactive client.
 *
 * The server is headless, so the client asks for the project trust, finds the server,
 * opens the session on it and hands the session to the terminal UI.
 */
export async function startInteractive(context: InteractiveStartContext): Promise<void> {
	await ensureProjectTrust(context);

	const server = await ensureServer({ agentDir: context.agentDir, command: SERVER_COMMAND, args: [] });
	const client = new PiServerClient({ url: server.url, password: server.password });
	const resume = await resolveResumeTarget(context);
	const snapshot = await openRemoteSession({
		url: server.url,
		password: server.password,
		cwd: context.cwd,
		sessionDir: context.sessionDir,
		title: context.parsed.name,
		model: context.parsed.model,
		thinkingLevel: context.parsed.thinking,
		resume,
	});

	const facade = new RemoteSessionFacade(client, snapshot.sessionId, snapshot.cwd || context.cwd, {
		agentDir: context.agentDir,
	});
	await facade.load();

	const { InteractiveMode } = await import("./interactive-mode.ts");
	const mode = new InteractiveMode(facade, {
		initialMessage: context.initialMessage,
		initialImages: context.initialImages,
		initialMessages: context.parsed.messages,
		verbose: context.parsed.verbose,
		tuiMode: context.parsed.tuiMode,
		initialThemeSetting: context.parsed.useTheme,
	});
	await mode.run();
}

/**
 * Ask for the project trust when the policy is "ask" and the trust store has no decision.
 *
 * The server never prompts. It reads the trust store, so the decision is written before
 * the session is opened.
 */
async function ensureProjectTrust(context: InteractiveStartContext): Promise<void> {
	if (context.settingsManager.getDefaultProjectTrust() !== "ask") return;
	const trustStore = new ProjectTrustStore(context.agentDir);
	if (trustStore.get(context.cwd) !== null) return;
	const trusted = await askYesNo(`Trust the project folder ${context.cwd}?`);
	trustStore.set(context.cwd, trusted);
}

/**
 * The session the command line asks for, as the server understands it.
 */
async function resolveResumeTarget(context: InteractiveStartContext): Promise<"recent" | string | undefined> {
	const target = context.parsed.session;
	if (target !== undefined) {
		if (target.endsWith(".jsonl") && existsSync(target)) return target;
		return SessionManager.findById(context.cwd, target, context.sessionDir) ?? target;
	}
	if (context.parsed.continue) return "recent";
	if (!context.parsed.resume) return undefined;
	return pickSessionPath(context.cwd, context.sessionDir);
}

/**
 * Ask which session to resume.
 */
async function pickSessionPath(cwd: string, sessionDir: string | undefined): Promise<string | undefined> {
	const sessions = await SessionManager.list(cwd, sessionDir);
	if (sessions.length === 0) {
		console.log("There is no session to resume.");
		return undefined;
	}
	console.log("Sessions:");
	for (const [index, session] of sessions.entries()) {
		const label = session.name ?? session.firstMessage ?? session.id;
		console.log(`  ${index + 1}) ${label}  ${session.path}`);
	}
	const answer = await askLine("Session number to resume (empty to cancel): ");
	const number = Number.parseInt(answer.trim(), 10);
	if (!Number.isFinite(number) || number < 1 || number > sessions.length) return undefined;
	return sessions[number - 1]?.path;
}

/**
 * The body of a session creation request.
 */
interface OpenSessionOptions {
	url: string;
	password: string;
	cwd: string;
	sessionDir: string | undefined;
	title: string | undefined;
	model: string | undefined;
	thinkingLevel: string | undefined;
	resume: "recent" | string | undefined;
}

/**
 * Open a session on the server.
 */
async function openRemoteSession(options: OpenSessionOptions): Promise<SessionStateSnapshot> {
	const body: Record<string, unknown> = { cwd: options.cwd };
	if (options.sessionDir !== undefined) body.sessionDir = options.sessionDir;
	if (options.title !== undefined) body.title = options.title;
	if (options.model !== undefined) body.model = options.model;
	if (options.thinkingLevel !== undefined) body.thinkingLevel = options.thinkingLevel;
	if (options.resume !== undefined) body.resume = options.resume;

	const response = await fetch(`${options.url}/pi/session`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: basicAuthHeader(options.password) },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`The server refused to open the session: ${text}`);
	}
	const payload = (await response.json()) as { data: SessionStateSnapshot };
	return payload.data;
}

/**
 * Ask the server for a pairing code.
 */
async function requestPairingCode(url: string): Promise<string> {
	try {
		const response = await fetch(`${url}/api/pair`, { method: "POST" });
		if (response.ok) {
			const body = (await response.json()) as { code?: string };
			if (body.code) return body.code;
		}
	} catch {}
	const pairing = createPairingCode();
	console.log("The server did not hand out a pairing code; this one only works on a server that knows it.");
	return pairing.code;
}

/**
 * The url of the server on the local network.
 */
function lanUrlFor(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	const address = lanAddress();
	if (!address) return url;
	return `http://${address}:${parsed.port || "80"}`;
}

/**
 * The first non-internal IPv4 address of this machine.
 */
function lanAddress(): string | undefined {
	for (const addresses of Object.values(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family !== "IPv4" || address.internal) continue;
			return address.address;
		}
	}
	return undefined;
}

/**
 * The runtime factory the foreground server uses.
 */
function createServerRuntimeFactory(
	agentDir: string,
	settingsManager: SettingsManager,
): CreateAgentSessionRuntimeFactory {
	return createRuntimeFactory({
		agentDir,
		parsed: parseArgs([]),
		startupSettingsManager: settingsManager,
		trustStore: new ProjectTrustStore(agentDir),
		appMode: () => "interactive",
		trustPromptMode: "interactive",
		extensionFactories: [],
		projectTrustContextFactory: (cwd, mode, hasUI) => ({
			cwd,
			mode: mode === "interactive" ? "tui" : mode,
			hasUI,
			ui: {
				select: async (_title, options) => options[0],
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
		}),
	});
}

/**
 * Wait for a termination signal.
 */
async function waitForSignal(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	process.once("SIGINT", () => resolve());
	process.once("SIGTERM", () => resolve());
	await promise;
}

/**
 * Ask a yes or no question.
 */
async function askYesNo(question: string): Promise<boolean> {
	const answer = await askLine(`${question} [y/N] `);
	return /^y(es)?$/i.test(answer.trim());
}

/**
 * Ask for a line of input.
 */
async function askLine(question: string): Promise<string> {
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const { promise, resolve } = Promise.withResolvers<string>();
		readline.question(question, resolve);
		return await promise;
	} finally {
		readline.close();
	}
}

/**
 * Parse the flags of a subcommand.
 */
function parseFlags(args: string[]): Record<string, string | boolean> {
	const flags: Record<string, string | boolean> = {};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg?.startsWith("--")) continue;
		const name = arg.slice(2);
		const value = args[index + 1];
		if (value !== undefined && !value.startsWith("--")) {
			flags[name] = value;
			index++;
		} else {
			flags[name] = true;
		}
	}
	return flags;
}

/**
 * The value of a flag that takes one.
 */
function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
	const value = flags[name];
	return typeof value === "string" ? value : undefined;
}

/**
 * The value of a flag that takes a number.
 */
function numberFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
	const value = stringFlag(flags, name);
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The message of an error.
 */
function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Whether this module is the entry point of the process.
 */
function isProcessEntry(): boolean {
	if (typeof PI_BUNDLED_NODE !== "undefined") return PI_BUNDLED_NODE === true;
	const entry = process.argv[1];
	if (entry === undefined) return false;
	if (import.meta.url === pathToFileURL(entry).href) return true;
	try {
		return import.meta.url === pathToFileURL(realpathSync(entry)).href;
	} catch {
		return false;
	}
}

/**
 * Prepare the process for the client.
 */
function setupClient(): void {
	process.title = "pi";
	process.env.PI_CODING_AGENT = "true";
	process.env.AI_AGENT = "pi";
}

if (isProcessEntry()) {
	setupClient();
	runClient(process.argv.slice(2)).catch((error: unknown) => {
		console.error(describe(error));
		process.exitCode = 1;
	});
}
