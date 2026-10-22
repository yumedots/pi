/**
 * Finding or starting the server.
 *
 * The client looks for a running server through the registration file. When there is none,
 * or the registered one is dead, it starts one and waits for it to answer.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { basicAuthHeader, type ServerRegistration } from "@earendil-works/pi-server";

/** How long the client waits for a freshly spawned server to answer. */
export const SERVER_START_TIMEOUT_MS = 10_000;

/**
 * The arguments the client starts a server with.
 *
 * The server picks a free port and writes the URL into the registration file, so a running
 * server never collides with another one.
 */
const SERVER_ARGS = ["--port", "0"];

/** The options of {@link ensureServer}. */
export interface EnsureServerOptions {
	/** The agent directory that holds the registration file. */
	agentDir: string;
	/** The command that starts a server. Empty means "resolve it from the server package". */
	command?: string;
	/** The arguments of the command. */
	args?: string[];
}

/** A server the client can talk to. */
export interface RunningServer {
	/** The base URL of the server. */
	url: string;
	/** The password the client authenticates with. */
	password: string;
	/** The process id of the server. */
	pid: number;
}

/**
 * Read the registration file of an agent directory.
 */
export function readServerRegistration(agentDir: string): ServerRegistration | undefined {
	const path = join(agentDir, "server.json");
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as ServerRegistration;
	} catch {
		return undefined;
	}
}

/**
 * Whether a registered server answers and still runs.
 */
export async function isServerAlive(registration: ServerRegistration): Promise<boolean> {
	try {
		const response = await fetch(`${registration.url}/api/info`, {
			headers: { authorization: basicAuthHeader(registration.password) },
			signal: AbortSignal.timeout(2000),
		});
		if (!response.ok) return false;
		const body = (await response.json()) as { pid?: number };
		return body.pid === registration.pid;
	} catch {
		return false;
	}
}

/**
 * The flags Node needs to run a TypeScript file.
 *
 * Bun runs TypeScript natively; Node only strips the types from 23.6 on, so the older
 * supported versions need the flag.
 */
function typeStrippingArgs(): string[] {
	if (process.versions.bun) return [];
	const major = Number(process.versions.node.split(".")[0]);
	return major >= 23 ? [] : ["--experimental-strip-types"];
}

/**
 * Find the server binary.
 *
 * The server is a package next to the client, so the client starts it from the package it
 * installed, not from `$PATH`: the `pi-server` binary is not on the path when the client
 * runs from a checkout or from a global install without the server package linked.
 */
export function resolveServerCommand(): { command: string; args: string[] } {
	const override = process.env.PI_SERVER_COMMAND;
	if (override && override.trim().length > 0) {
		const [command, ...args] = override.split(" ");
		return { command: command!, args };
	}

	try {
		const require = createRequire(import.meta.url);
		const manifestPath = require.resolve("@earendil-works/pi-server/package.json");
		const packageRoot = dirname(manifestPath);
		// The source comes first: in a checkout the built file can be stale, and the
		// published package ships only `dist`.
		const source = join(packageRoot, "src", "cli.ts");
		if (existsSync(source)) {
			return { command: process.execPath, args: [...typeStrippingArgs(), source, ...SERVER_ARGS] };
		}
		const built = join(packageRoot, "dist", "cli.js");
		if (existsSync(built)) {
			return { command: process.execPath, args: [built, ...SERVER_ARGS] };
		}
	} catch {
		// The server package is not installed next to the client; fall back to the path.
	}

	return { command: "pi-server", args: [] };
}

/**
 * Find a running server, or start one.
 *
 * @returns The server the client should talk to.
 */
export async function ensureServer(options: EnsureServerOptions): Promise<RunningServer> {
	const registration = readServerRegistration(options.agentDir);
	if (registration && (await isServerAlive(registration))) {
		return { url: registration.url, password: registration.password, pid: registration.pid };
	}

	const command = options.command ? { command: options.command, args: options.args ?? [] } : resolveServerCommand();
	const child = spawn(command.command, command.args, {
		detached: true,
		stdio: "ignore",
	});
	child.unref();

	const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		const started = readServerRegistration(options.agentDir);
		if (started && (await isServerAlive(started))) {
			return { url: started.url, password: started.password, pid: started.pid };
		}
	}
	throw new Error(
		`The server did not start within ${SERVER_START_TIMEOUT_MS} ms: ${command.command} ${command.args.join(" ")}`.trim(),
	);
}
