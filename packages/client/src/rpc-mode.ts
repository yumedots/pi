/**
 * The rpc mode.
 *
 * The commands arrive as JSON lines on the standard input, the answers and the events of
 * the session go to the standard output. The runtime lives in the server, so the client
 * hands the commands over and prints what the server answers.
 */

import { createInterface } from "node:readline";
import type { RpcCommand, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import type { PiServerClient } from "@earendil-works/pi-server/client";
import { toJsonEvent } from "./client-support/json-event.ts";

/**
 * Run the rpc mode.
 *
 * The mode runs until the standard input ends or the user asks the agent to stop.
 *
 * @returns The exit code of the run.
 */
export async function runRpcMode(client: PiServerClient, sessionId: string): Promise<number> {
	const write = (value: unknown): void => {
		process.stdout.write(`${JSON.stringify(value)}\n`);
	};

	const unsubscribe = client.events(sessionId, (event) => {
		write(toJsonEvent(event));
	});

	const reader = createInterface({ input: process.stdin, terminal: false });
	let exitCode = 0;
	try {
		for await (const line of reader) {
			const trimmed = line.trim();
			if (trimmed.length === 0) continue;

			let payload: Record<string, unknown>;
			try {
				payload = JSON.parse(trimmed) as Record<string, unknown>;
			} catch {
				write({ type: "response", command: "unknown", success: false, error: "The command is not valid JSON" });
				continue;
			}

			// The answer of a dialog the server asked for.
			if (payload.type === "extension_ui_response") {
				await client.respondExtensionUi(sessionId, payload as unknown as RpcExtensionUIResponse);
				continue;
			}

			const command = payload as unknown as RpcCommand;
			try {
				const response = await client.sendCommand(sessionId, command);
				write(response);
			} catch (error: unknown) {
				write({
					type: "response",
					command: typeof command.type === "string" ? command.type : "unknown",
					success: false,
					error: error instanceof Error ? error.message : String(error),
				});
				exitCode = 1;
			}
		}
	} finally {
		reader.close();
		unsubscribe();
	}

	return exitCode;
}
