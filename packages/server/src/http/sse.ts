/**
 * Server-Sent Events helper.
 *
 * The opencode clients expect a specific header set and a specific frame layout, so the
 * server writes the headers itself instead of leaning on a framework.
 */

import type { ServerResponse } from "node:http";

/** An open SSE connection. */
export interface SseConnection {
	/** Write one chunk. */
	send(chunk: string): void;
	/** Close the connection. */
	close(): void;
	/** Whether the connection is still open. */
	readonly closed: boolean;
}

/**
 * Open an SSE connection on a response.
 */
export function openSse(res: ServerResponse): SseConnection {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		"x-accel-buffering": "no",
		"x-content-type-options": "nosniff",
	});
	res.flushHeaders?.();

	let closed = false;
	res.on("close", () => {
		closed = true;
	});

	return {
		send(chunk: string): void {
			if (closed) return;
			res.write(chunk);
		},
		close(): void {
			if (closed) return;
			closed = true;
			res.end();
		},
		get closed(): boolean {
			return closed;
		},
	};
}

/**
 * Format one SSE frame.
 *
 * @param data The payload. It is JSON-encoded once.
 */
export function sseFrame(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * The opencode heartbeat comment.
 */
export const SSE_HEARTBEAT = ": heartbeat\n\n";
