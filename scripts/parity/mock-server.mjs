import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const CHUNK_DELAY_MS = 15;

export const MOCK_MODEL_ID = "mock-1";
export const MOCK_PROVIDER_ID = "mock";
export const MOCK_API_KEY = "parity-key";

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(delta, finishReason = null, usage = null) {
	const body = {
		id: "chatcmpl-parity",
		object: "chat.completion.chunk",
		created: 0,
		model: MOCK_MODEL_ID,
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	};
	if (usage) body.usage = usage;
	return body;
}

const USAGE = { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 };

function textChunks(text) {
	const parts = text.match(/\S+\s*/g) ?? [text];
	const chunks = parts.map((part) => chunk({ content: part }));
	chunks.push(chunk({}, "stop", USAGE));
	return chunks;
}

function toolCallChunks(turn) {
	const chunks = [
		chunk({
			tool_calls: [
				{
					index: 0,
					id: turn.id ?? "call_parity_1",
					type: "function",
					function: {
						name: turn.name,
						arguments: JSON.stringify(turn.arguments ?? {}),
					},
				},
			],
		}),
		chunk({}, "tool_calls", USAGE),
	];
	return chunks;
}

/** A reasoning run (`reasoning_content`) followed by the answer text. */
function thinkingChunks(turn) {
	const chunks = [];
	for (const part of (turn.thinking ?? "").match(/\S+\s*/g) ?? []) {
		chunks.push(chunk({ reasoning_content: part }));
	}
	chunks.push(...textChunks(turn.text ?? ""));
	return chunks;
}

function chunksForTurn(turn) {
	if (turn.type === "toolCall") return toolCallChunks(turn);
	if (turn.type === "thinking") return thinkingChunks(turn);
	return textChunks(turn.text ?? "");
}

export function startMockServer(script = {}) {
	const turns = script.turns?.length ? script.turns : [{ type: "text", text: "Hello from the parity mock." }];
	const requests = [];
	let calls = 0;
	const server = createServer((request, response) => {
		const body = [];
		request.on("error", () => {});
		response.on("error", () => {});
		request.on("data", (chunk) => body.push(chunk));
		request.on("end", async () => {
			requests.push({ url: request.url, body: Buffer.concat(body).toString("utf8") });
			const turn = turns[Math.min(calls, turns.length - 1)];
			calls += 1;
			response.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			for (const part of chunksForTurn(turn)) {
				if (response.writableEnded || response.destroyed) return;
				response.write(`data: ${JSON.stringify(part)}\n\n`);
				await sleep(CHUNK_DELAY_MS);
			}
			if (response.writableEnded || response.destroyed) return;
			response.write("data: [DONE]\n\n");
			response.end();
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolve({
				baseUrl: `http://127.0.0.1:${port}/v1`,
				requests,
				close: () => new Promise((done) => server.close(done)),
			});
		});
	});
}

export function startMockServerProcess(script = {}) {
	const child = spawn(process.execPath, [join(HERE, "mock-server.mjs")], {
		env: { ...process.env, PI_PARITY_MOCK_SCRIPT: JSON.stringify(script) },
		stdio: ["ignore", "pipe", "inherit"],
	});
	return new Promise((resolve, reject) => {
		let buffer = "";
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString();
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			const { baseUrl } = JSON.parse(buffer.slice(0, newline));
			resolve({
				baseUrl,
				close: () =>
					new Promise((done) => {
						child.once("exit", done);
						child.kill();
					}),
			});
		});
		child.on("error", reject);
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const script = process.env.PI_PARITY_MOCK_SCRIPT ? JSON.parse(process.env.PI_PARITY_MOCK_SCRIPT) : {};
	const mock = await startMockServer(script);
	console.log(JSON.stringify({ baseUrl: mock.baseUrl }));
}
