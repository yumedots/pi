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
import { basicAuthHeader, type ServerRegistration } from "@earendil-works/pi-server/client";
import { SETTINGS_DEFAULTS } from "@earendil-works/pi-support/settings-defaults";
import { CONFIG_DIR_NAME } from "./client-support/config.ts";

/** How long the client waits for a freshly spawned server to answer. */
export const SERVER_START_TIMEOUT_MS = 10_000;

/**
 * The interface a server listens on when the settings do not say otherwise.
 *
 * The server is password protected, so it listens on every interface: that is what makes
 * it reachable from a phone on the same network.
 */
export const DEFAULT_SERVER_HOSTNAME = "0.0.0.0";

/**
 * The arguments the client starts a server with.
 *
 * The server picks a free port and writes the URL into the registration file, so a running
 * server never collides with another one.
 */
/**
 * The arguments the server is started with.
 *
 * A command that already names a port keeps it: the compiled binary's sibling command
 * carries `--port 0` already.
 */
function serverArgs(existing: readonly string[], hostname: string): string[] {
	const args: string[] = [];
	if (!existing.includes("--port")) args.push("--port", "0");
	if (!existing.includes("--hostname")) args.push("--hostname", hostname);
	return args;
}

/** The options of {@link ensureServer}. */
export interface EnsureServerOptions {
	/** The agent directory that holds the registration file. */
	agentDir: string;
	/** The command that starts a server. Empty means "resolve it from the server package". */
	command?: string;
	/** The arguments of the command. */
	args?: string[];
	/** The interface the server listens on. Defaults to the one from the settings. */
	hostname?: string;
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
export function resolveServerCommand(hostname: string = DEFAULT_SERVER_HOSTNAME): { command: string; args: string[] } {
	const override = process.env.PI_SERVER_COMMAND;
	if (override && override.trim().length > 0) {
		const [command, ...args] = override.split(" ");
		return { command: command!, args: [...args, ...serverArgs(args, hostname)] };
	}

	try {
		const require = createRequire(import.meta.url);
		const manifestPath = require.resolve("@earendil-works/pi-server/package.json");
		const packageRoot = dirname(manifestPath);
		// The source comes first: in a checkout the built file can be stale, and the
		// published package ships only `dist`.
		const source = join(packageRoot, "src", "cli.ts");
		if (existsSync(source)) {
			return {
				command: process.execPath,
				args: [...typeStrippingArgs(), source, ...serverArgs([], hostname)],
			};
		}
		const built = join(packageRoot, "dist", "cli.js");
		if (existsSync(built)) {
			return { command: process.execPath, args: [built, ...serverArgs([], hostname)] };
		}
	} catch {
		// The server package is not installed next to the client; fall back to the path.
	}

	return { command: "pi-server", args: serverArgs([], hostname) };
}

/**
 * The interface a server listens on.
 *
 * The settings decide, so a user who pinned the server to the loopback address keeps
 * that.
 */
export function resolveServerHostname(agentDir: string): string {
	try {
		return readServerSettings(process.cwd(), agentDir).hostname;
	} catch {
		return DEFAULT_SERVER_HOSTNAME;
	}
}

/** The settings of the server, as the client reads them before it has a manifest. */
export interface ServerSettings {
	/** The port the server binds. */
	port: number;
	/** The interface the server listens on. */
	hostname: string;
	/** How long the server stays up without a client, in milliseconds. */
	idleTimeoutMs: number;
}

/** Whether a value is a record of settings. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a settings file. A file that cannot be read holds no settings. */
function readSettingsFile(path: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/** Merge two layers of settings, the way the server merges them. */
function mergeSettings(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
	const merged = { ...base };
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) continue;
		const current = merged[key];
		merged[key] = isRecord(current) && isRecord(value) ? mergeSettings(current, value) : value;
	}
	return merged;
}

/**
 * The settings of a directory, as the server reads them.
 *
 * The client starts the server before it has a manifest, so there is no mirror of the
 * settings yet: the files are the source until the server answers.
 */
export function readSettingsRecord(cwd: string, agentDir: string): Record<string, unknown> {
	const global = readSettingsFile(join(agentDir, "settings.json"));
	const project = readSettingsFile(join(cwd, CONFIG_DIR_NAME, "settings.json"));
	return mergeSettings(global, project);
}

/**
 * The settings of the server, as the server reads them.
 *
 * The port, the interface and the idle timeout decide how the server starts, and the
 * client has to know them before the server runs.
 */
export function readServerSettings(cwd: string, agentDir: string): ServerSettings {
	const settings = readSettingsRecord(cwd, agentDir).server;
	const server = isRecord(settings) ? settings : {};
	const port = server.port;
	const hostname = server.hostname;
	const idleTimeoutMs = server.idleTimeoutMs;
	return {
		port: typeof port === "number" && port >= 0 && port <= 65535 ? port : SETTINGS_DEFAULTS.server.port,
		hostname:
			typeof hostname === "string" && hostname.trim().length > 0
				? hostname.trim()
				: SETTINGS_DEFAULTS.server.hostname,
		idleTimeoutMs:
			typeof idleTimeoutMs === "number" && idleTimeoutMs >= 0
				? idleTimeoutMs
				: SETTINGS_DEFAULTS.server.idleTimeoutMs,
	};
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

	const hostname = options.hostname ?? resolveServerHostname(options.agentDir);
	const command = options.command
		? { command: options.command, args: [...(options.args ?? []), ...serverArgs(options.args ?? [], hostname)] }
		: resolveServerCommand(hostname);
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
