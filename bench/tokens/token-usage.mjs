#!/usr/bin/env node
/**
 * Measures the token usage of one fixed request.
 *
 * The agent talks to a llama.cpp server through a local proxy, so the request
 * that goes out can be measured next to the usage the server reports. The
 * breakdown shows where the tokens go: the system prompt, the tool schemas and
 * the user message.
 *
 * Usage:
 *   node bench/tokens/token-usage.mjs [options]
 *
 * Options:
 *   --runs <n>        Requests with the same prompt (default: 3)
 *   --prompt <text>   The prompt to send (default: "Say hello in three words")
 *   --agent-dir <dir> The agent directory (default: PI_BENCH_AGENT_DIR)
 *   --runtime <name>  node, bun or rpi (default: rpi when the Rust binary is
 *                     there, node otherwise)
 *   --json <path>     Write the measurements as JSON
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PKG = join(REPO_ROOT, "packages/coding-agent");
const RPI_BINARY = join(REPO_ROOT, "rpi/target/release/rpi");
const UPSTREAM = process.env.PI_LLAMA_URL ?? "http://127.0.0.1:8081";

const TS_RPC = {
	isState: (event) => event.type === "response" && event.command === "get_state",
	isTurnEnd: (event) => event.type === "agent_settled",
	prompt: (message) => ({ id: "p", type: "prompt", message }),
};

const RPI_RPC = {
	isState: (event) => event.type === "response" && event.id === "s" && event.status === "ok",
	isTurnEnd: (event) => event.type === "response" && event.id === "p" && event.status === "ok",
	prompt: (message) => ({ id: "p", type: "prompt", content: message }),
};

const RUNTIMES = {
	node: {
		command: process.execPath,
		args: [join(PKG, "dist/cli.js"), "--mode", "rpc", "--no-session"],
		agentDirEnv: "PI_CODING_AGENT_DIR",
		rpc: TS_RPC,
	},
	bun: {
		command: "bun",
		args: [join(PKG, "src/cli.ts"), "--mode", "rpc", "--no-session"],
		agentDirEnv: "PI_CODING_AGENT_DIR",
		rpc: TS_RPC,
	},
	rpi: {
		command: RPI_BINARY,
		args: ["--mode", "rpc", "--no-session"],
		agentDirEnv: "PI_CODING_AGENT_DIR",
		rpc: RPI_RPC,
	},
};

const options = {
	runs: 3,
	prompt: "Say hello in three words",
	agentDir: process.env.PI_BENCH_AGENT_DIR,
	runtime: existsSync(RPI_BINARY) ? "rpi" : "node",
	json: undefined,
};

for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	const value = process.argv[++index];
	if (arg === "--runs") options.runs = Number.parseInt(value, 10);
	else if (arg === "--prompt") options.prompt = value;
	else if (arg === "--agent-dir") options.agentDir = resolve(value);
	else if (arg === "--runtime") options.runtime = value;
	else if (arg === "--json") options.json = resolve(value);
	else throw new Error(`Unknown option: ${arg}`);
}

/** A proxy in front of the llama server that keeps the request that goes out. */
function startCaptureProxy(port) {
	const captured = [];
	const server = createServer((request, response) => {
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			const body = Buffer.concat(chunks);
			if (request.method === "POST" && request.url?.includes("chat/completions")) {
				captured.push({ body: body.toString("utf8"), at: performance.now() });
			}
			const target = new URL(request.url ?? "/", UPSTREAM);
			const forwarded = httpRequest(
				{
					method: request.method,
					hostname: target.hostname,
					port: target.port,
					path: target.pathname + target.search,
					headers: { ...request.headers, host: target.host },
				},
				(upstreamResponse) => {
					response.writeHead(upstreamResponse.statusCode ?? 500, upstreamResponse.headers);
					upstreamResponse.pipe(response);
				},
			);
			forwarded.end(body);
		});
	});
	return new Promise((resolvePromise) => {
		server.listen(port, "127.0.0.1", () => resolvePromise({ server, captured }));
	});
}

/** True when the request that goes out carries the tool declarations. */
function carriesTools(body) {
	try {
		return (JSON.parse(body).tools?.length ?? 0) > 0;
	} catch {
		return false;
	}
}

/** Count the tokens of a text with the tokenizer of the model. */
async function countTokens(text) {
	const response = await fetch(`${UPSTREAM}/tokenize`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content: text }),
	});
	const result = await response.json();
	return result.tokens?.length ?? 0;
}

/** Run the agent in rpc mode and collect the usage of one turn. */
function runTurn(runtime, agentDir, prompt) {
	return new Promise((resolvePromise, reject) => {
		const { command, args, agentDirEnv, rpc } = RUNTIMES[runtime];
		const child = spawn(command, args, {
			cwd: REPO_ROOT,
			env: { ...process.env, [agentDirEnv]: agentDir ?? "" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let buffer = "";
		const usage = [];
		let sentAt = 0;
		let firstTokenMs;
		let ready = false;
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			buffer += chunk;
			let index;
			while ((index = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				if (!line.trim()) continue;
				let event;
				try {
					event = JSON.parse(line);
				} catch {
					continue;
				}
				if (rpc.isState(event) && !ready) {
					// The session is up. The prompt goes out now, so the measurement
					// does not include the startup of the agent.
					ready = true;
					sentAt = performance.now();
					child.stdin.write(`${JSON.stringify(rpc.prompt(prompt))}\n`);
					continue;
				}
				if (event.type === "message_update" && firstTokenMs === undefined) {
					firstTokenMs = performance.now() - sentAt;
				}
				if (event.type === "message_end" && event.message?.usage) {
					usage.push(event.message.usage);
				}
				if (rpc.isTurnEnd(event)) {
					child.stdin.end();
					resolvePromise({ usage: usage.at(-1), firstTokenMs, sentAt });
				}
			}
		});
		child.once("error", reject);
		child.stdin.write(`${JSON.stringify({ id: "s", type: "get_state" })}\n`);
	});
}

async function main() {
	const port = 8099;
	const { server, captured } = await startCaptureProxy(port);
	const sourceAgentDir = options.agentDir;
	const model = { provider: "local", id: "smollm2-1.7b-instruct" };
	// The agent has to talk to the proxy, so it gets a directory of its own that points
	// at the proxy. The settings and the credentials of the source directory are copied.
	const agentDir = mkdtempSync(join(tmpdir(), "pi-token-bench-"));
	if (sourceAgentDir) {
		for (const file of ["settings.json", "auth.json"]) {
			const source = join(sourceAgentDir, file);
			if (existsSync(source)) copyFileSync(source, join(agentDir, file));
		}
	}
	const modelsPath = join(agentDir, "models.json");
	const models = sourceAgentDir && existsSync(join(sourceAgentDir, "models.json"))
		? JSON.parse(readFileSync(join(sourceAgentDir, "models.json"), "utf8"))
		: { providers: {} };
	for (const provider of Object.values(models.providers ?? {})) {
		if (typeof provider.baseUrl === "string") provider.baseUrl = `http://127.0.0.1:${port}/v1`;
	}
	writeFileSync(modelsPath, `${JSON.stringify(models, null, "\t")}\n`);
	if (options.runtime === "rpi") {
		// The Rust port picks its model from the settings, so the measured model is
		// pinned there.
		writeFileSync(
			join(agentDir, "settings.json"),
			`${JSON.stringify({ defaultProvider: model.provider, defaultModel: model.id }, null, "\t")}\n`,
		);
	}
	const runs = [];
	try {
		for (let index = 0; index < options.runs; index++) {
			const capturedBefore = captured.length;
			const run = await runTurn(options.runtime, agentDir, options.prompt);
			const requests = captured.slice(capturedBefore);
			// The time from the prompt leaving the agent to the request reaching the
			// model. The request that carries the tools is the one of the turn, so it
			// is the one that is measured.
			const request = requests.find((entry) => carriesTools(entry.body)) ?? requests[0];
			if (request && run.sentAt) {
				run.requestMs = request.at - run.sentAt;
			}
			run.requests = requests.length;
			runs.push(run);
			process.stdout.write(
				`run ${index + 1}: input=${run.usage?.input} output=${run.usage?.output} cacheRead=${run.usage?.cacheRead} requests=${run.requests} request=${run.requestMs?.toFixed(0)}ms firstToken=${run.firstTokenMs?.toFixed(0)}ms\n`,
			);
		}
	} finally {
		server.close();
		rmSync(agentDir, { recursive: true, force: true });
	}

	const breakdown = [];
	if (captured.length > 0) {
		const payload = JSON.parse(captured.at(-1).body);
		for (const message of payload.messages ?? []) {
			const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
			breakdown.push({
				label: `message:${message.role}`,
				chars: text.length,
				tokens: await countTokens(text),
			});
		}
		for (const tool of payload.tools ?? []) {
			const text = JSON.stringify(tool);
			breakdown.push({
				label: `tool:${tool.function?.name ?? tool.name}`,
				chars: text.length,
				tokens: await countTokens(text),
			});
		}
	}

	const result = {
		date: new Date().toISOString(),
		prompt: options.prompt,
		model,
		runtime: options.runtime,
		runs: runs.map((run) => ({
			input: run.usage?.input,
			output: run.usage?.output,
			cacheRead: run.usage?.cacheRead,
			cacheWrite: run.usage?.cacheWrite,
			total: run.usage?.totalTokens,
			requests: run.requests,
			requestMs: run.requestMs,
			firstTokenMs: run.firstTokenMs,
		})),
		breakdown,
	};
	if (options.json) {
		mkdirSync(dirname(options.json), { recursive: true });
		writeFileSync(options.json, `${JSON.stringify(result, null, 2)}\n`);
	}
	for (const part of breakdown) {
		process.stdout.write(`${part.label.padEnd(24)} chars=${String(part.chars).padStart(7)} tokens=${String(part.tokens).padStart(6)}\n`);
	}
	const total = breakdown.reduce((sum, part) => sum + part.tokens, 0);
	process.stdout.write(`${"TOTAL".padEnd(24)} ${" ".repeat(20)}tokens=${String(total).padStart(6)}\n`);
}

main().catch((error) => {
	process.stderr.write(`${error.stack ?? error.message}\n`);
	process.exit(1);
});
