/**
 * Finding or starting the server.
 *
 * The client looks for a running server through the registration file. When there is none,
 * or the registered one is dead, it starts one and waits for it to answer.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { basicAuthHeader, type ServerRegistration } from "@earendil-works/pi-server";

/** How long the client waits for a freshly spawned server to answer. */
export const SERVER_START_TIMEOUT_MS = 10_000;

/** The options of {@link ensureServer}. */
export interface EnsureServerOptions {
	/** The agent directory that holds the registration file. */
	agentDir: string;
	/** The command that starts a server. */
	command: string;
	/** The arguments of the command. */
	args: string[];
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
 * Find a running server, or start one.
 *
 * @returns The server the client should talk to.
 */
export async function ensureServer(options: EnsureServerOptions): Promise<RunningServer> {
	const registration = readServerRegistration(options.agentDir);
	if (registration && (await isServerAlive(registration))) {
		return { url: registration.url, password: registration.password, pid: registration.pid };
	}

	const child = spawn(options.command, options.args, {
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
	throw new Error(`The server did not start within ${SERVER_START_TIMEOUT_MS} ms: ${options.command}`);
}
