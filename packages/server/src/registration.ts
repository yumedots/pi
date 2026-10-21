/**
 * The registration file.
 *
 * A client finds a running server through `<agentDir>/server.json`. The file names the
 * server, its URL, its pid and its password, so a client can probe it and stop it.
 */

import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The contents of the registration file. */
export interface ServerRegistration {
	/** The server instance id. */
	id: string;
	/** The server version. */
	version: string;
	/** The base URL of the server. */
	url: string;
	/** The process id of the server. */
	pid: number;
	/** The password clients authenticate with. */
	password: string;
}

/** The file name inside the agent directory. */
export const REGISTRATION_FILE_NAME = "server.json";

/** The path of the registration file for an agent directory. */
export function registrationPath(agentDir: string): string {
	return join(agentDir, REGISTRATION_FILE_NAME);
}

/**
 * Write the registration file.
 *
 * The file is written to a temporary path and renamed, so a reader never sees a partial
 * file, and it is only readable by its owner.
 */
export function writeRegistration(agentDir: string, registration: ServerRegistration): string {
	const target = registrationPath(agentDir);
	const temp = `${target}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(registration, null, 2)}\n`, { mode: 0o600 });
	chmodSync(temp, 0o600);
	renameSync(temp, target);
	return target;
}

/**
 * Read the registration file.
 *
 * @returns The registration, or `undefined` when there is none.
 */
export function readRegistration(agentDir: string): ServerRegistration | undefined {
	const path = registrationPath(agentDir);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as ServerRegistration;
		if (typeof parsed.id !== "string" || typeof parsed.url !== "string") return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

/**
 * Remove the registration file.
 *
 * The file is only removed when it still describes this instance, so a restarted server
 * never deletes the registration of its successor.
 */
export function clearRegistration(agentDir: string, id: string): void {
	const registration = readRegistration(agentDir);
	if (!registration || registration.id !== id) return;
	rmSync(registrationPath(agentDir), { force: true });
}
