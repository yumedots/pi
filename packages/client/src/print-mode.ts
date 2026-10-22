/**
 * The print mode.
 *
 * The client is a renderer, so a headless run is a run of the server that the client
 * prints the answer of. The client starts the server, opens a session, sends the
 * prompt, waits for the turn to end and prints what the server answered.
 *
 * The mode is the one of the coding agent: "text" prints the answer of the model, "json"
 * prints the events of the session as they happen.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import type { PiServerClient } from "@earendil-works/pi-server/client";

/** The options of the print mode. */
export interface PrintModeOptions {
	/** The output mode: "text" prints the answer, "json" prints the events. */
	mode: "text" | "json";
	/** The messages to send, one after the other. */
	messages: string[];
	/** The images of the first message. */
	initialImages?: ImageContent[];
}

/** A message of the session, as the client reads it. */
interface SessionMessage {
	role?: string;
	content?: unknown;
	stopReason?: string;
	errorMessage?: string;
}

/**
 * Run the print mode.
 *
 * @returns The exit code of the run.
 */
export async function runPrintMode(
	client: PiServerClient,
	sessionId: string,
	options: PrintModeOptions,
): Promise<number> {
	const { mode, messages } = options;
	let exitCode = 0;
	let turnEnded: (() => void) | undefined;
	const turnSettled = new Promise<void>((resolve) => {
		turnEnded = resolve;
	});
	const unsubscribe = client.events(sessionId, (event) => {
		if (mode === "json") {
			process.stdout.write(`${JSON.stringify(event)}\n`);
		}
		if (event.type === "agent_settled") {
			turnEnded?.();
		}
	});

	try {
		for (const [index, message] of messages.entries()) {
			await runTurn(client, sessionId, message, index === 0 ? options.initialImages : undefined, turnSettled);
		}

		if (mode === "text") {
			const answer = await finalAnswer(client, sessionId);
			if (!answer) {
				process.stderr.write("The model did not answer.\n");
				exitCode = 1;
			} else if (answer.stopReason === "error" || answer.stopReason === "aborted") {
				process.stderr.write(`${answer.errorMessage || `Request ${answer.stopReason}`}\n`);
				exitCode = 1;
			} else {
				for (const text of textOf(answer)) {
					process.stdout.write(`${text}\n`);
				}
				if (answer.stopReason === "length") {
					process.stderr.write("Response was truncated: the model reached its output token limit.\n");
					exitCode = 1;
				}
			}
		}
	} catch (error: unknown) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		exitCode = 1;
	} finally {
		unsubscribe();
	}

	return exitCode;
}

/**
 * Send a prompt and wait for the turn to end.
 */
async function runTurn(
	client: PiServerClient,
	sessionId: string,
	message: string,
	images: ImageContent[] | undefined,
	turnSettled: Promise<void>,
): Promise<void> {
	const response = await client.sendCommand(sessionId, {
		type: "prompt",
		message,
		...(images && images.length > 0 ? { images } : {}),
	});
	// A prompt the server refused never starts a turn, so waiting for the end of one would
	// wait forever.
	if (response && "success" in response && response.success === false) {
		throw new Error(response.error);
	}
	await turnSettled;
}

/**
 * The last message of the model.
 */
async function finalAnswer(client: PiServerClient, sessionId: string): Promise<SessionMessage | undefined> {
	const messages = (await client.messages(sessionId)) as SessionMessage[];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "assistant") return message;
	}
	return undefined;
}

/**
 * The text of a message of the model.
 */
function textOf(message: SessionMessage): string[] {
	const content = message.content;
	if (!Array.isArray(content)) return [];
	const texts: string[] = [];
	for (const part of content) {
		if (typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part) {
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string") texts.push(text);
		}
	}
	return texts;
}
