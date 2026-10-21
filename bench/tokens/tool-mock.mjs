#!/usr/bin/env node
/**
 * A model that answers with a tool call, so a turn that runs a tool can be measured.
 *
 * The model of the benchmark does not call tools, so the tool turn is measured against
 * this server: every request that carries the tool declarations gets a tool call back,
 * every other request (the context summary of the Rust port) gets a short text.
 *
 * Usage:
 *   node bench/tokens/tool-mock.mjs
 *
 * The base url of the server is printed on stdout as JSON.
 */
import { createServer } from "node:http";

const CHUNK_DELAY_MS = 10;
const USAGE = { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 };

function chunk(delta, finishReason = null) {
	return {
		id: "chatcmpl-token-bench",
		object: "chat.completion.chunk",
		created: 0,
		model: "mock-1",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
		usage: USAGE,
	};
}

function textChunks(text) {
	const parts = text.match(/\S+\s*/g) ?? [text];
	const chunks = parts.map((part) => chunk({ content: part }));
	chunks.push(chunk({}, "stop"));
	return chunks;
}

function toolCallChunks() {
	return [
		chunk({
			tool_calls: [
				{
					index: 0,
					id: "call_token_bench_1",
					type: "function",
					function: { name: "read", arguments: JSON.stringify({ path: "bench/README.md" }) },
				},
			],
		}),
		chunk({}, "tool_calls"),
	];
}

function sleep(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

const requests = [];
let answeredWithTool = false;

const server = createServer((request, response) => {
	const chunks = [];
	request.on("error", () => {});
	response.on("error", () => {});
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", async () => {
		const raw = Buffer.concat(chunks).toString("utf8");
		let payload = {};
		try {
			payload = JSON.parse(raw);
		} catch {}
		requests.push(payload);
		const isTurn = (payload.tools?.length ?? 0) > 0 && !answeredWithTool;
		if (isTurn) answeredWithTool = true;
		response.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		const parts = isTurn
			? toolCallChunks()
			: textChunks("There is nothing to summarize yet.");
		for (const part of parts) {
			if (response.writableEnded || response.destroyed) return;
			response.write(`data: ${JSON.stringify(part)}\n\n`);
			await sleep(CHUNK_DELAY_MS);
		}
		if (response.writableEnded || response.destroyed) return;
		response.write("data: [DONE]\n\n");
		response.end();
	});
});

server.listen(0, "127.0.0.1", () => {
	const { port } = server.address();
	process.stdout.write(`${JSON.stringify({ baseUrl: `http://127.0.0.1:${port}/v1`, requests })}\n`);
});
