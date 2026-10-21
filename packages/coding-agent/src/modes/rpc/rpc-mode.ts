/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 *
 * The command vocabulary lives in `core/session-controller.ts`; this module owns the JSONL
 * framing, the stdout ownership and the process signals.
 */

import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { SessionController } from "../../core/session-controller.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { toJsonEvent } from "../json-event.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type { RpcCommand, RpcExtensionUIRequest, RpcExtensionUIResponse, RpcResponse } from "./rpc-types.ts";

// Re-export types for consumers
export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	RpcSlashCommand,
} from "./rpc-types.ts";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
	takeOverStdout();

	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};

	// Pending extension UI requests waiting for a response from the client.
	const pendingExtensionRequests = new Map<
		string,
		{ resolve: (value: RpcExtensionUIResponse) => void; reject: (error: Error) => void }
	>();

	// Shutdown request flag
	let shutdownRequested = false;
	let shuttingDown = false;
	const signalCleanupHandlers: Array<() => void> = [];

	let unsubscribeBackpressure: (() => void) | undefined;

	const controller = new SessionController(runtimeHost, {
		onEvent: (event) => {
			output(toJsonEvent(event));
		},
		requestExtensionUi: async (request) => {
			// Fire-and-forget methods are never answered by the client.
			if (
				request.method !== "select" &&
				request.method !== "confirm" &&
				request.method !== "input" &&
				request.method !== "editor"
			) {
				output(request);
				return { type: "extension_ui_response", id: request.id, cancelled: true };
			}
			output(request);
			return new Promise<RpcExtensionUIResponse>((resolve, reject) => {
				pendingExtensionRequests.set(request.id, { resolve, reject });
			});
		},
		onShutdownRequested: () => {
			shutdownRequested = true;
		},
		onExtensionError: (error) => {
			output({
				type: "extension_error",
				extensionPath: error.extensionPath,
				event: error.event,
				error: error.error,
			});
		},
		onSessionRebind: () => {
			unsubscribeBackpressure?.();
			unsubscribeBackpressure = controller.session.agent.subscribe(async () => {
				await waitForRawStdoutBackpressure();
			});
		},
	});

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	await controller.rebind();
	registerSignalHandlers();

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 * Called after handling each command when waiting for the next command.
	 */
	let detachInput = () => {};

	async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
		if (shuttingDown) {
			process.exit(exitCode);
		}
		shuttingDown = true;
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		unsubscribeBackpressure?.();
		controller.dispose();
		await runtimeHost.dispose();
		detachInput();
		process.stdin.pause();
		if (signal !== "SIGTERM") {
			await flushRawStdout();
		}
		process.exit(exitCode);
	}

	async function checkShutdownRequested(): Promise<void> {
		if (!shutdownRequested) return;
		await shutdown();
	}

	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			output({
				type: "response",
				command: "parse",
				success: false,
				error: `Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
			} as RpcResponse);
			await waitForRawStdoutBackpressure();
			return;
		}

		// Handle extension UI responses
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"type" in parsed &&
			parsed.type === "extension_ui_response"
		) {
			const response = parsed as RpcExtensionUIResponse;
			const pending = pendingExtensionRequests.get(response.id);
			if (pending) {
				pendingExtensionRequests.delete(response.id);
				pending.resolve(response);
			}
			return;
		}

		const command = parsed as RpcCommand;
		try {
			const response = await controller.handle(command);
			if (response) {
				output(response);
				await waitForRawStdoutBackpressure();
			}
			await checkShutdownRequested();
		} catch (commandError: unknown) {
			output({
				id: command.id,
				type: "response",
				command: command.type,
				success: false,
				error: commandError instanceof Error ? commandError.message : String(commandError),
			} as RpcResponse);
			await waitForRawStdoutBackpressure();
		}
	};

	const onInputEnd = () => {
		void shutdown();
	};
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
			void handleInputLine(line);
		});
		return () => {
			detachJsonl();
			process.stdin.off("end", onInputEnd);
		};
	})();

	// Keep process alive forever
	return new Promise(() => {});
}
