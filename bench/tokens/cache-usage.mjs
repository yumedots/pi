#!/usr/bin/env node
/**
 * Measures what the prompt cache is worth, per turn, for the local llama.cpp
 * server and for the same conversation on the TypeScript original.
 *
 * The local server reuses its KV cache for a byte-identical prompt prefix, so
 * the number that matters is the SERVER's own accounting: `timings.prompt_n`
 * (the tokens of the prompt) against `timings.cache_n` (the tokens reused
 * from the prefix cache). The tokens the server had to PROCESS are
 * `prompt_n - cache_n` — that is the per-turn cost of the request.
 *
 * For every turn this reports:
 *   - promptTokens: what the server was given
 *   - cachedTokens:  what the server reused
 *   - processed:     what the server had to compute (prompt_n - cache_n)
 *   - bytes:         the size of the request body that went out
 *   - prefixBytes:   the bytes shared with the previous turn's request body
 *
 * The prefix check is the local case's own cache condition: if the request
 * body of turn N+1 does not start with the request body of turn N, the server
 * cannot reuse the prefix and the whole prompt is reprocessed.
 *
 * Usage:
 *   node bench/tokens/cache-usage.mjs [options]
 *
 * Options:
 *   --turns <n>        Messages in the conversation (default: 5)
 *   --runs <n>         Repetitions (default: 1)
 *   --runtimes <list>  Comma separated: node, rpi (default: both that are present)
 *   --rpi <path>       The Rust binary (default: rpi/target/release/rpi)
 *   --ts-repo <dir>    The TypeScript repository (default: this repository)
 *   --agent-dir <dir>  The agent directory (default: PI_BENCH_AGENT_DIR)
 *   --cwd <dir>        The working directory of the agent (default: the runtime's repo)
 *   --json <path>      Write the measurements as JSON
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const RPI_BINARY = join(REPO_ROOT, "rpi/target/release/rpi");
const UPSTREAM = process.env.PI_LLAMA_URL ?? "http://127.0.0.1:8081";
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
	rpi: {
		command: (rpi) => rpi,
		args: () => ["--mode", "rpc", "--no-session"],
		rpc: RPI_RPC,
	},
};

const options = {
	turns: 5,
	runs: 1,
	runtimes: undefined,
	agentDir: process.env.PI_BENCH_AGENT_DIR,
	rpi: RPI_BINARY,
	tsRepo: REPO_ROOT,
	cwd: undefined,
	json: undefined,
};

for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	if (arg === "--turns") options.turns = Number.parseInt(process.argv[++index], 10);
	else if (arg === "--runs") options.runs = Number.parseInt(process.argv[++index], 10);
	else if (arg === "--runtimes") options.runtimes = process.argv[++index].split(",").map((n) => n.trim()).filter(Boolean);
	else if (arg === "--rpi") options.rpi = resolve(process.argv[++index]);
	else if (arg === "--ts-repo") options.tsRepo = resolve(process.argv[++index]);
	else if (arg === "--agent-dir") options.agentDir = resolve(process.argv[++index]);
	else if (arg === "--cwd") options.cwd = resolve(process.argv[++index]);
	else if (arg === "--json") options.json = resolve(process.argv[++index]);
	else throw new Error(`Unknown option: ${arg}`);
}

/** The conversation: five turns, so the per-turn cost has room to settle. */
const PROMPTS = [
	"Say hello in three words",
	"Now say it in French, in three words.",
	"And once more, in English, in three words.",
	"Now say it in German, in three words.",
	"Finally, in Spanish, in three words.",
];

/** A proxy in front of the model that keeps the request that goes out and the usage of the answer. */
function startCaptureProxy(upstream) {
	const captured = [];
	const server = createServer((request, response) => {
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			const body = Buffer.concat(chunks);
			const entry = { body: body.toString("utf8"), usage: null };
			if (request.method === "POST" && request.url?.includes("chat/completions")) captured.push(entry);
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
					upstreamResponse.on("data", (chunk) => (text += chunk.toString("utf8")));
					upstreamResponse.on("end", () => (entry.usage = parseUsage(text)));
					upstreamResponse.pipe(response);
				},
			);
			forwarded.end(body);
		});
	});
	return new Promise((resolvePromise) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolvePromise({ server, captured, url: `http://127.0.0.1:${port}` });
		});
	});
}

/** The server's own accounting: `timings.prompt_n` against `timings.cache_n`. */
function parseUsage(text) {
	const result = { promptTokens: null, cachedTokens: null, completionTokens: null };
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
		}
	}
	return result;
}

/** The agent directory of one run: the settings of the source, the models pointed at the proxy. */
function prepareAgentDir(proxyUrl) {
	const sourceAgentDir = options.agentDir;
	const agentDir = mkdtempSync(join(tmpdir(), "pi-cache-bench-"));
	if (sourceAgentDir) {
		for (const file of ["settings.json", "auth.json"]) {
			const source = join(sourceAgentDir, file);
			if (existsSync(source)) copyFileSync(source, join(agentDir, file));
		}
	}
	const modelsPath = join(agentDir, "models.json");
	const models =
		sourceAgentDir && existsSync(join(sourceAgentDir, "models.json"))
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
				defaultProjectTrust: "always",
			},
			null,
			"\t",
		)}\n`,
	);
	return agentDir;
}

/** Run the agent in rpc mode and collect the requests of every turn. */
function runTurns(runtime, agentDir, cwd, prompts, captured) {
	return new Promise((resolvePromise, reject) => {
		const { command, args, rpc } = RUNTIMES[runtime];
		const binary = typeof command === "function" ? command(options.rpi) : command;
		const child = spawn(binary, args(runtime === "rpi" ? options.rpi : options.tsRepo), {
			cwd,
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir ?? "" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let buffer = "";
		let ready = false;
		let settled = 0;
		const turns = [];
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => (stderr += chunk));
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
				if (rpc.isTurnEnd(event, `p${settled}`)) {
					settled++;
					if (settled >= prompts.length) {
						child.stdin.end();
						resolvePromise({ turns, stderr });
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

/** The bytes two request bodies share from the start. */
function sharedPrefix(a, b) {
	const limit = Math.min(a.length, b.length);
	let index = 0;
	while (index < limit && a[index] === b[index]) index++;
	return index;
}

/** One run of the conversation against one runtime. */
async function measure(runtime) {
	const { server, captured, url } = await startCaptureProxy(UPSTREAM);
	const agentDir = prepareAgentDir(url);
	const cwd = options.cwd ?? (runtime === "rpi" ? REPO_ROOT : options.tsRepo);
	try {
		const { turns, stderr } = await runTurns(runtime, agentDir, cwd, PROMPTS, captured);
		const measured = [];
		let previousBody = null;
		for (const turn of turns) {
			const to = turn.index + 1 < turns.length ? turns[turn.index + 1].from : captured.length;
			const requests = [];
			for (const entry of captured.slice(turn.from, to)) {
				const usage = entry.usage ?? { promptTokens: null, cachedTokens: null, completionTokens: null };
				const prefixBytes = previousBody === null ? null : sharedPrefix(previousBody, entry.body);
				requests.push({
					bytes: entry.body.length,
					prefixBytes,
					promptTokens: usage.promptTokens,
					cachedTokens: usage.cachedTokens,
					processed:
						usage.promptTokens === null || usage.cachedTokens === null
							? null
							: usage.promptTokens - usage.cachedTokens,
					completionTokens: usage.completionTokens,
					carriesTools: (() => {
						try {
							return (JSON.parse(entry.body).tools?.length ?? 0) > 0;
						} catch {
							return false;
						}
					})(),
				});
				previousBody = entry.body;
			}
			measured.push({ turn: turn.index, prompt: PROMPTS[turn.index], requests });
		}
		return { runtime, cwd, turns: measured, stderr: stderr.slice(0, 2000) };
	} finally {
		server.close();
		rmSync(agentDir, { recursive: true, force: true });
	}
}

async function main() {
	const available = ["node", "rpi"].filter((name) =>
		name === "node" ? existsSync(join(options.tsRepo, "packages/coding-agent/dist/cli.js")) : existsSync(options.rpi),
	);
	const runtimes = options.runtimes ?? available;
	for (const runtime of runtimes) {
		if (!available.includes(runtime)) {
			throw new Error(`the ${runtime} runtime is not available here`);
		}
	}
	const runs = [];
	for (let run = 0; run < options.runs; run++) {
		for (const runtime of runtimes) {
			const result = await measure(runtime);
			result.run = run;
			runs.push(result);
		}
	}

	console.log(`\nconversation: ${PROMPTS.length} turns, ${options.runs} run(s)\n`);
	for (const runtime of runtimes) {
		for (const run of runs.filter((r) => r.runtime === runtime)) {
			console.log(`# ${runtime} (run ${run.run})`);
			console.log("turn | request bytes | prefix bytes | prompt tok | cached tok | processed | output");
			for (const turn of run.turns) {
				for (const request of turn.requests) {
					const fmt = (value) => (value === null || value === undefined ? "-" : String(value));
					console.log(
						`${String(turn.turn).padStart(4)} | ${String(request.bytes).padStart(13)} | ${String(request.prefixBytes ?? "-").padStart(12)} | ${String(request.promptTokens ?? "-").padStart(10)} | ${String(request.cachedTokens ?? "-").padStart(10)} | ${String(request.processed ?? "-").padStart(9)} | ${String(request.completionTokens ?? "-").padStart(6)}`,
					);
				}
			}
			const totals = run.turns.flatMap((turn) => turn.requests);
			const processed = totals.reduce((sum, request) => sum + (request.processed ?? 0), 0);
			const cached = totals.reduce((sum, request) => sum + (request.cachedTokens ?? 0), 0);
			console.log(`  total processed ${processed}, total cached ${cached}\n`);
		}
	}

	if (options.json) {
		mkdirSync(dirname(options.json), { recursive: true });
		writeFileSync(
			options.json,
			`${JSON.stringify({ date: new Date().toISOString(), model: MODEL, prompts: PROMPTS, runtimes, runs }, null, "\t")}\n`,
		);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
