#!/usr/bin/env node
/**
 * Measures the token usage of a conversation, the TypeScript agent against the Rust port.
 *
 * The agent talks to the model through a local proxy, so the request that goes out is
 * measured next to the usage the server reports. The breakdown shows where the tokens
 * go: the system prompt (section by section), the tool declarations (one line per
 * tool) and the messages of the conversation.
 *
 * The token counts are the tokenizer of the model itself (`/tokenize` of the llama.cpp
 * server), not an estimate. The prompt-cache numbers come from the server: llama.cpp
 * reports the tokens it reused from the prefix cache (`timings.cache_n`) next to the
 * tokens of the prompt (`timings.prompt_n`).
 *
 * Usage:
 *   node bench/tokens/token-usage.mjs [options]
 *
 * Options:
 *   --runs <n>         Repetitions of the scenario (default: 3)
 *   --prompt <text>    The first user message (default: "Say hello in three words")
 *   --scenario <name>  single (one message), conversation (three messages) or
 *                       tool (one message that runs a tool) (default: single)
 *   --runtimes <list>  Comma separated: node, bun, rpi (default: rpi when the
 *                       Rust binary is there, node otherwise)
 *   --agent-dir <dir>  The agent directory (default: PI_BENCH_AGENT_DIR)
 *   --rpi <path>       The Rust binary (default: rpi/target/release/rpi)
 *   --rpi-args <args>  Extra arguments for the Rust binary (space separated)
 *   --ts-repo <dir>    The TypeScript repository (default: this repository)
 *   --cwd <dir>        The working directory of the agent (default: the repository
 *                       of the runtime, so each side runs with its own project context)
 *   --trust <mode>     always or never: the project trust of the agent
 *                       (default: always, so the project context is in the prompt)
 *   --own-server       Start a fresh llama-server for every run, so the prompt
 *                       cache of the server starts empty
 *   --model <path>     The model of the own server
 *   --dump <dir>       Write every request that goes out to this directory
 *   --json <path>      Write the measurements as JSON
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
let tokenizerUrl = UPSTREAM;
const MODEL = { provider: "local", id: "smollm2-1.7b-instruct" };

const TS_RPC = {
	prompt: (id, message) => ({ id, type: "prompt", message }),
	isState: (event) => event.type === "response" && event.command === "get_state",
	isTurnEnd: (event) => event.type === "agent_settled",
};

const RPI_RPC = {
	prompt: (id, message) => ({ id, type: "prompt", content: message }),
	isState: (event) => event.type === "response" && event.id === "s" && event.status === "ok",
	isTurnEnd: (event, id) => event.type === "response" && event.id === id && event.status === "ok",
};

const RUNTIMES = {
	node: {
		command: process.execPath,
		args: (tsRepo) => [join(tsRepo, "packages/coding-agent/dist/cli.js"), "--mode", "rpc", "--no-session"],
		rpc: TS_RPC,
	},
	bun: {
		command: "bun",
		args: (tsRepo) => [join(tsRepo, "packages/coding-agent/src/cli.ts"), "--mode", "rpc", "--no-session"],
		rpc: TS_RPC,
	},
	rpi: {
		command: (rpi) => rpi,
		args: (rpi, extra) => ["--mode", "rpc", "--no-session", ...extra],
		rpc: RPI_RPC,
	},
};

const SCENARIOS = {
	single: (prompt) => [prompt],
	conversation: (prompt) => [
		prompt,
		"Now say it in French, in three words.",
		"And once more, in English, in three words.",
	],
	tool: (prompt) => [`${prompt} Use the read tool to read the file bench/README.md.`],
};

const options = {
	runs: 3,
	warmup: 1,
	prompt: "Say hello in three words",
	scenario: "single",
	runtimes: undefined,
	agentDir: process.env.PI_BENCH_AGENT_DIR,
	rpi: RPI_BINARY,
	rpiArgs: [],
	tsRepo: REPO_ROOT,
	cwd: undefined,
	trust: "always",
	ownServer: false,
	model: join(process.env.HOME ?? "", ".local/share/pi-models/smollm2-1.7b-instruct-q4_k_m.gguf"),
	dump: undefined,
	json: undefined,
};

for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	if (arg === "--own-server") {
		options.ownServer = true;
		continue;
	}
	const value = process.argv[++index];
	if (arg === "--runs") options.runs = Number.parseInt(value, 10);
	else if (arg === "--warmup") options.warmup = Number.parseInt(value, 10);
	else if (arg === "--prompt") options.prompt = value;
	else if (arg === "--scenario") options.scenario = value;
	else if (arg === "--runtimes") options.runtimes = value.split(",").map((name) => name.trim()).filter(Boolean);
	else if (arg === "--runtime") options.runtimes = [value.trim()];
	else if (arg === "--agent-dir") options.agentDir = resolve(value);
	else if (arg === "--rpi") options.rpi = resolve(value);
	else if (arg === "--rpi-args") options.rpiArgs = value.split(" ").filter(Boolean);
	else if (arg === "--ts-repo") options.tsRepo = resolve(value);
	else if (arg === "--cwd") options.cwd = resolve(value);
	else if (arg === "--trust") options.trust = value;
	else if (arg === "--own-server") options.ownServer = true;
	else if (arg === "--model") options.model = resolve(value);
	else if (arg === "--dump") options.dump = resolve(value);
	else if (arg === "--json") options.json = resolve(value);
	else throw new Error(`Unknown option: ${arg}`);
}

if (!SCENARIOS[options.scenario]) throw new Error(`Unknown scenario: ${options.scenario}`);

/** A proxy in front of the model that keeps the request that goes out and the usage of the answer. */
function startCaptureProxy(upstream) {
	const captured = [];
	const server = createServer((request, response) => {
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			const body = Buffer.concat(chunks);
			const entry = {
				body: body.toString("utf8"),
				at: performance.now(),
				usage: null,
			};
			const isCompletion = request.method === "POST" && request.url?.includes("chat/completions");
			if (isCompletion) captured.push(entry);
			const target = new URL(request.url ?? "/", upstream);
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
					let text = "";
					upstreamResponse.on("data", (chunk) => {
						text += chunk.toString("utf8");
					});
					upstreamResponse.on("end", () => {
						entry.usage = parseUsage(text);
					});
					upstreamResponse.pipe(response);
				},
			);
			forwarded.end(body);
		});
	});
	return new Promise((resolvePromise) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolvePromise({ server, captured, port, url: `http://127.0.0.1:${port}` });
		});
	});
}

/** The token counts of the answer: the server's own numbers, not an estimate. */
function parseUsage(text) {
	const result = { promptTokens: null, cachedTokens: null, completionTokens: null, source: null };
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) continue;
		const payload = trimmed.slice(5).trim();
		if (!payload || payload === "[DONE]") continue;
		let parsed;
		try {
			parsed = JSON.parse(payload);
		} catch {
			continue;
		}
		const timings = parsed.timings;
		if (timings) {
			result.promptTokens = timings.prompt_n ?? result.promptTokens;
			result.cachedTokens = timings.cache_n ?? result.cachedTokens;
			result.completionTokens = timings.predicted_n ?? result.completionTokens;
			result.source = "llama-timings";
		}
		const usage = parsed.usage;
		if (usage) {
			result.promptTokens = usage.prompt_tokens ?? result.promptTokens;
			result.completionTokens = usage.completion_tokens ?? result.completionTokens;
			const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? null;
			if (cached !== null) result.cachedTokens = cached;
			result.source = result.source ?? "usage";
		}
	}
	return result;
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
	if (!text) return 0;
	const response = await fetch(`${tokenizerUrl}/tokenize`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content: text }),
	});
	const result = await response.json();
	return result.tokens?.length ?? 0;
}

/** The tagged blocks of a system prompt, outermost first. */
function topLevelTags(text) {
	const tags = [];
	const re = /<([a-z][a-z0-9_-]*)>/g;
	let match;
	while ((match = re.exec(text)) !== null) {
		const name = match[1];
		const close = `</${name}>`;
		const closeIndex = text.indexOf(close, match.index + match[0].length);
		if (closeIndex < 0) continue;
		tags.push({
			name,
			start: match.index,
			end: closeIndex + close.length,
			text: text.slice(match.index, closeIndex + close.length),
		});
		re.lastIndex = closeIndex + close.length;
	}
	return tags;
}

/** Cut a system prompt into its parts: the preamble, the rules and the tagged blocks. */
function splitSystem(runtime, text) {
	const tags = topLevelTags(text);
	const parts = [];
	const plain = [];
	let cursor = 0;
	for (const tag of tags) {
		const before = text.slice(cursor, tag.start);
		if (before.trim()) plain.push(before);
		parts.push({ label: tag.name, text: tag.text });
		cursor = tag.end;
	}
	const rest = text.slice(cursor);
	if (rest.trim()) plain.push(rest);
	const remainder = plain.join("\n\n").trim();
	if (remainder) {
		if (runtime === "rpi") {
			for (const part of splitPortRemainder(remainder)) parts.unshift(part);
		} else {
			parts.unshift({ label: "preamble", text: remainder });
		}
	}
	return parts;
}

/** The Rust port writes one flat prompt: the preamble, the tool list, the rules and the cwd. */
function splitPortRemainder(text) {
	const parts = [];
	const markers = [
		{ label: "preamble", start: null, end: "Available tools:" },
		{ label: "tools", start: "Available tools:", end: "\n\nIn addition to the tools above" },
		{ label: "rules", start: "\n\nGuidelines:", end: "\n\nCurrent working directory:" },
		{ label: "cwd", start: "\n\nCurrent working directory:", end: null },
	];
	for (const marker of markers) {
		let slice;
		if (marker.start === null) {
			const end = text.indexOf(marker.end);
			slice = end < 0 ? text : text.slice(0, end);
		} else {
			const start = text.indexOf(marker.start);
			if (start < 0) continue;
			const from = start + marker.start.length;
			const end = marker.end === null ? text.length : text.indexOf(marker.end, from);
			slice = text.slice(from, end < 0 ? text.length : end);
		}
		const trimmed = slice.trim();
		if (trimmed) parts.push({ label: marker.label, text: trimmed });
	}
	return parts;
}

/** The text of a message as it goes out. */
function messageText(message) {
	if (typeof message.content === "string") return message.content;
	return JSON.stringify(message.content ?? "");
}

/** The breakdown of one request: the system prompt, the tools and the conversation. */
async function breakdownRequest(entry, runtime) {
	let payload;
	try {
		payload = JSON.parse(entry.body);
	} catch {
		return null;
	}
	const messages = payload.messages ?? [];
	const system = messages.find((message) => message.role === "system" || message.role === "developer");
	const conversation = messages.filter((message) => message !== system);
	const systemText = system ? messageText(system) : "";
	const systemParts = [];
	for (const part of splitSystem(runtime, systemText)) {
		systemParts.push({
			label: `system:${part.label}`,
			chars: part.text.length,
			tokens: await countTokens(part.text),
		});
	}
	const toolParts = [];
	for (const tool of payload.tools ?? []) {
		const text = JSON.stringify(tool);
		toolParts.push({
			label: `tool:${tool.function?.name ?? tool.name}`,
			chars: text.length,
			tokens: await countTokens(text),
		});
	}
	const toolsText = JSON.stringify(payload.tools ?? []);
	const messageParts = [];
	for (const message of conversation) {
		const text = messageText(message);
		messageParts.push({
			label: `message:${message.role}`,
			chars: text.length,
			tokens: await countTokens(text),
		});
	}
	const systemTokens = systemParts.reduce((sum, part) => sum + part.tokens, 0);
	const toolsTokens = toolParts.reduce((sum, part) => sum + part.tokens, 0);
	const messagesTokens = messageParts.reduce((sum, part) => sum + part.tokens, 0);
	return {
		carriesTools: (payload.tools?.length ?? 0) > 0,
		system: {
			chars: systemText.length,
			tokens: await countTokens(systemText),
			parts: systemParts,
		},
		tools: {
			chars: toolsText.length,
			tokens: await countTokens(toolsText),
			parts: toolParts,
		},
		messages: {
			count: conversation.length,
			chars: messageParts.reduce((sum, part) => sum + part.chars, 0),
			tokens: messagesTokens,
			parts: messageParts,
		},
		countedTotal: systemTokens + toolsTokens + messagesTokens,
		server: entry.usage,
	};
}

/** Run the agent in rpc mode and collect the requests of every turn. */
function runTurns(runtime, agentDir, cwd, prompts, captured) {
	return new Promise((resolvePromise, reject) => {
		const { command, args, rpc } = RUNTIMES[runtime];
		const binary = typeof command === "function" ? command(options.rpi) : command;
		const child = spawn(binary, args(runtime === "rpi" ? options.rpi : options.tsRepo, options.rpiArgs), {
			cwd,
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir ?? "" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let buffer = "";
		let ready = false;
		let settled = 0;
		const usages = [];
		const turns = [];
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
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
					ready = true;
					send(0);
					continue;
				}
				if (event.type === "message_end" && event.message?.usage) {
					usages.push(event.message.usage);
				}
				if (rpc.isTurnEnd(event, `p${settled}`)) {
					settled++;
					if (settled >= prompts.length) {
						child.stdin.end();
						resolvePromise({ usages, turns, stderr });
						return;
					}
					send(settled);
				}
			}
		});
		child.once("error", reject);
		function send(index) {
			const before = captured.length;
			child.stdin.write(`${JSON.stringify(rpc.prompt(`p${index}`, prompts[index]))}\n`);
			turns.push({ index, from: before });
		}
		child.stdin.write(`${JSON.stringify({ id: "s", type: "get_state" })}\n`);
	});
}

/** A fresh llama-server, so the prompt cache of the server starts empty. */
async function startOwnServer() {
	const port = 8100 + Math.floor(Math.random() * 400);
	const child = spawn(
		"llama-server",
		["-m", options.model, "--port", String(port), "--ctx-size", "8192"],
		{ stdio: ["ignore", "ignore", "ignore"] },
	);
	const url = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 60000;
	for (;;) {
		if (child.exitCode !== null) throw new Error(`llama-server exited with ${child.exitCode}`);
		try {
			const response = await fetch(`${url}/health`);
			if (response.ok) break;
		} catch {
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		}
		if (Date.now() > deadline) {
			child.kill();
			throw new Error("llama-server did not come up");
		}
	}
	return {
		url,
		stop: async () => {
			child.kill();
			await new Promise((resolvePromise) => child.once("exit", resolvePromise));
		},
	};
}

/** The agent directory of one run: the settings of the source, the models pointed at the proxy. */
function prepareAgentDir(proxyUrl) {
	const sourceAgentDir = options.agentDir;
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
		if (typeof provider.baseUrl === "string") provider.baseUrl = `${proxyUrl}/v1`;
	}
	writeFileSync(modelsPath, `${JSON.stringify(models, null, "\t")}\n`);
	writeFileSync(
		join(agentDir, "settings.json"),
		`${JSON.stringify(
			{
				defaultProvider: MODEL.provider,
				defaultModel: MODEL.id,
				defaultProjectTrust: options.trust,
			},
			null,
			"\t",
		)}\n`,
	);
	return agentDir;
}

/** The model that answers with a tool call, so a tool turn can be measured. */
function startToolMock() {
	const child = spawn(process.execPath, [join(HERE, "tool-mock.mjs")], { stdio: ["ignore", "pipe", "inherit"] });
	return new Promise((resolvePromise, reject) => {
		let buffer = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			const { baseUrl } = JSON.parse(buffer.slice(0, newline));
			resolvePromise({
				baseUrl,
				close: async () => {
					child.kill();
					await new Promise((done) => child.once("exit", done));
				},
			});
		});
		child.once("error", reject);
	});
}

/** One run of the scenario against one runtime. */
async function measure(runtime, prompts, upstream) {
	const { server, captured, url } = await startCaptureProxy(upstream);
	const agentDir = prepareAgentDir(url);
	const cwd = options.cwd ?? (runtime === "rpi" ? REPO_ROOT : options.tsRepo);
	try {
		const { usages, turns, stderr } = await runTurns(runtime, agentDir, cwd, prompts, captured);
		const measured = [];
		for (const turn of turns) {
			const to = turn.index + 1 < turns.length ? turns[turn.index + 1].from : captured.length;
			const requests = [];
			for (const entry of captured.slice(turn.from, to)) {
				const breakdown = await breakdownRequest(entry, runtime);
				if (breakdown) {
					breakdown.raw = entry.body;
					requests.push(breakdown);
				}
			}
			measured.push({
				turn: turn.index,
				prompt: prompts[turn.index],
				usage: usages[turn.index] ?? null,
				requests,
			});
		}
		return { runtime, cwd, turns: measured, stderr: stderr.slice(0, 2000) };
	} finally {
		server.close();
		rmSync(agentDir, { recursive: true, force: true });
	}
}

/** The check of the harness: the breakdown has to add up, and both sides have to be measured. */
function checkMeasurement(output) {
	const problems = [];
	for (const runtime of output.runtimes) {
		const runs = output.runs.filter((run) => run.runtime === runtime);
		if (runs.length === 0) problems.push(`${runtime}: no run measured`);
		for (const run of runs) {
			for (const turn of run.turns) {
				if (turn.requests.length === 0) problems.push(`${runtime} run ${run.run} turn ${turn.turn}: no request`);
				for (const [index, request] of turn.requests.entries()) {
					const parts =
						request.system.parts.reduce((sum, part) => sum + part.tokens, 0) +
						request.tools.parts.reduce((sum, part) => sum + part.tokens, 0) +
						request.messages.parts.reduce((sum, part) => sum + part.tokens, 0);
					if (parts !== request.countedTotal) {
						problems.push(
							`${runtime} run ${run.run} turn ${turn.turn} request ${index}: parts ${parts} != total ${request.countedTotal}`,
						);
					}
					if (request.carriesTools && request.tools.parts.length === 0) {
						problems.push(`${runtime} run ${run.run} turn ${turn.turn} request ${index}: no tool measured`);
					}
					if (request.system.tokens === 0) {
						problems.push(`${runtime} run ${run.run} turn ${turn.turn} request ${index}: no system prompt measured`);
					}
				}
			}
		}
	}
	if (problems.length > 0) {
		throw new Error(`the measurement is not complete:\n  ${problems.join("\n  ")}`);
	}
}

async function main() {
	const runtimes = options.runtimes ?? [existsSync(options.rpi) ? "rpi" : "node"];
	const prompts = SCENARIOS[options.scenario](options.prompt);
	let upstream = UPSTREAM;
	const results = [];
	const runOnce = async (runtime, run, record) => {
		const server = options.ownServer && options.scenario !== "tool" ? await startOwnServer() : null;
		const mock = options.scenario === "tool" ? await startToolMock() : null;
		let upstream = UPSTREAM;
		if (server) {
			upstream = server.url;
			tokenizerUrl = server.url;
		}
		if (mock) upstream = mock.baseUrl;
		try {
			const result = await measure(runtime, prompts, upstream);
			result.run = run;
			if (!record) return;
			results.push(result);
			if (options.dump) {
				mkdirSync(options.dump, { recursive: true });
				for (const turn of result.turns) {
					for (const [index, request] of turn.requests.entries()) {
						const name = `${runtime}-run${result.run}-turn${turn.turn}-req${index}.json`;
						writeFileSync(join(options.dump, name), request.raw ?? "");
					}
				}
			}
			for (const turn of result.turns) {
				for (const request of turn.requests) {
					const serverUsage = request.server ?? {};
					process.stdout.write(
						`${runtime} run ${result.run} turn ${turn.turn}: requests=${turn.requests.length} ` +
							`prompt=${serverUsage.promptTokens ?? "?"} cached=${serverUsage.cachedTokens ?? "?"} ` +
							`counted=${request.countedTotal}\n`,
					);
				}
			}
		} finally {
			if (mock) await mock.close();
			if (server) {
				await server.stop();
				tokenizerUrl = UPSTREAM;
			}
		}
	};
	for (const runtime of runtimes) {
		for (let warmup = 0; warmup < options.warmup; warmup++) await runOnce(runtime, 0, false);
		for (let run = 1; run <= options.runs; run++) await runOnce(runtime, run, true);
	}

	const output = {
		date: new Date().toISOString(),
		prompt: options.prompt,
		scenario: options.scenario,
		model: MODEL,
		runtimes,
		runs: results,
	};
	checkMeasurement(output);
	if (options.json) {
		mkdirSync(dirname(options.json), { recursive: true });
		writeFileSync(options.json, `${JSON.stringify(output, null, 2)}\n`);
	}
	for (const result of results) {
		for (const turn of result.turns) {
			process.stdout.write(`\n== ${result.runtime} run ${result.run} turn ${turn.turn}: ${turn.prompt}\n`);
			for (const request of turn.requests) {
				const server = request.server ?? {};
				process.stdout.write(
					`  request: prompt=${server.promptTokens ?? "?"} cached=${server.cachedTokens ?? "?"} ` +
						`output=${server.completionTokens ?? "?"} counted=${request.countedTotal} ` +
						`tools=${request.carriesTools}\n`,
				);
				for (const part of request.system.parts) {
					process.stdout.write(
						`    ${part.label.padEnd(28)} chars=${String(part.chars).padStart(7)} tokens=${String(part.tokens).padStart(6)}\n`,
					);
				}
				process.stdout.write(
					`    ${"system:total".padEnd(28)} chars=${String(request.system.chars).padStart(7)} tokens=${String(request.system.tokens).padStart(6)}\n`,
				);
				for (const part of request.tools.parts) {
					process.stdout.write(
						`    ${part.label.padEnd(28)} chars=${String(part.chars).padStart(7)} tokens=${String(part.tokens).padStart(6)}\n`,
					);
				}
				process.stdout.write(
					`    ${"tools:total".padEnd(28)} chars=${String(request.tools.chars).padStart(7)} tokens=${String(request.tools.tokens).padStart(6)}\n`,
				);
				for (const part of request.messages.parts) {
					process.stdout.write(
						`    ${part.label.padEnd(28)} chars=${String(part.chars).padStart(7)} tokens=${String(part.tokens).padStart(6)}\n`,
					);
				}
				process.stdout.write(
					`    ${"messages:total".padEnd(28)} chars=${String(request.messages.chars).padStart(7)} tokens=${String(request.messages.tokens).padStart(6)}\n`,
				);
			}
		}
	}
}

main().catch((error) => {
	process.stderr.write(`${error.stack ?? error.message}\n`);
	process.exit(1);
});
