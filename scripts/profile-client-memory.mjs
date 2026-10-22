#!/usr/bin/env node
/**
 * The memory of the client and the server.
 *
 * The client and the server are two processes, and the whole point of the split is
 * that the client is a renderer: it must not load the coding agent runtime a second
 * time. This measures that:
 *
 * - the module graph of the client, in files, and how many of them belong to the
 *   coding agent (the runtime the client must not reach);
 * - the resident memory of a process that loaded the client, and of one that loaded
 *   the server, and the sum of the two;
 * - the resident memory of the two live processes, the way the user runs them.
 *
 * The memory is read from the operating system after the module graph is evaluated,
 * so it is the cost of the modules and not the cost of the work.
 *
 * Usage: node scripts/profile-client-memory.mjs [options]
 *
 * Options:
 *   --runs <n>        Number of measured runs (default: 3)
 *   --runtime <name>  bun or node (default: bun)
 *   --no-graph        Skip the module graph report
 *   --live            Also measure the two live processes (needs tmux)
 *   --binary <path>   The client binary to run for the live measurement
 *   --extensions <n>  Install n real extensions in the agent directory of the live run
 *   --help            Show this help
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SRC = join(ROOT, "packages", "client", "src");
const SERVER_SRC = join(ROOT, "packages", "server", "src");
const EXAMPLES = join(ROOT, "packages", "coding-agent", "examples", "extensions");

const WORKSPACE = {
	"@earendil-works/chord": "packages/chord/src",
	"@earendil-works/pi-ai": "packages/ai/src",
	"@earendil-works/pi-agent-core": "packages/agent/src",
	"@earendil-works/pi-codemode": "packages/codemode/src",
	"@earendil-works/pi-durable": "packages/durable/src",
	"@earendil-works/pi-mcp": "packages/mcp/src",
	"@earendil-works/pi-tui": "packages/tui/src",
	"@earendil-works/pi-coding-agent": "packages/coding-agent/src",
	"@earendil-works/pi-server": "packages/server/src",
	"@earendil-works/pi-client": "packages/client/src",
};

const VALUE_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)([^;]*?\sfrom\s*)?["']([^"']+)["']/g;

function parseArgs(argv) {
	const options = { runs: 3, runtime: "bun", graph: true, live: false, binary: "", extensions: 0 };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--runs") options.runs = Number.parseInt(argv[++index], 10);
		else if (arg === "--runtime") options.runtime = argv[++index];
		else if (arg === "--no-graph") options.graph = false;
		else if (arg === "--live") options.live = true;
		else if (arg === "--binary") options.binary = argv[++index];
		else if (arg === "--extensions") options.extensions = Number.parseInt(argv[++index], 10);
		else if (arg === "--help") {
			console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?/, ""));
			process.exit(0);
		}
	}
	if (!Number.isFinite(options.runs) || options.runs < 1) throw new Error("--runs needs a number");
	return options;
}

function sources(dir) {
	const files = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) files.push(...sources(path));
		else if (entry.endsWith(".ts")) files.push(path);
	}
	return files;
}

function resolveSpec(spec, fromFile) {
	if (spec.startsWith("node:")) return null;
	if (spec.startsWith(".")) {
		const base = resolve(dirname(fromFile), spec);
		for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
			if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
		}
		return null;
	}
	for (const [name, src] of Object.entries(WORKSPACE)) {
		if (spec === name) return resolve(ROOT, src, "index.ts");
		if (!spec.startsWith(`${name}/`)) continue;
		const tail = spec.slice(name.length + 1);
		for (const candidate of [`${tail}.ts`, `${tail}/index.ts`, tail]) {
			const file = resolve(ROOT, src, candidate);
			if (existsSync(file) && statSync(file).isFile()) return file;
		}
	}
	return null;
}

function valueImports(file) {
	const specs = [];
	for (const match of readFileSync(file, "utf8").matchAll(VALUE_IMPORT)) {
		if (match[2]) specs.push(match[2]);
	}
	return specs;
}

function graphOf(roots) {
	const seen = new Set();
	const queue = [...roots];
	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || seen.has(file)) continue;
		seen.add(file);
		for (const spec of valueImports(file)) {
			const target = resolveSpec(spec, file);
			if (target) queue.push(target);
		}
	}
	return [...seen].map((file) => relative(ROOT, file));
}

function reportGraph() {
	const client = graphOf(sources(CLIENT_SRC));
	const server = graphOf(sources(SERVER_SRC));
	const codingAgent = client.filter((file) => file.startsWith("packages/coding-agent/src/"));
	console.log("Module graph");
	console.log(`  client: ${client.length} files, ${codingAgent.length} of them in the coding agent`);
	for (const file of codingAgent.sort()) console.log(`    ${file}`);
	console.log(`  server: ${server.length} files`);
	return { client: client.length, codingAgent: codingAgent.length };
}

/**
 * The resident memory of a process that loaded the given modules.
 */
function measure(runtime, script) {
	const output = execFileSync(runtime, ["-e", script], { encoding: "utf8", cwd: ROOT });
	return Number.parseFloat(output.trim());
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

function reportMemory(options) {
	const clientScript = `
const before = process.memoryUsage().rss;
await import(${JSON.stringify(join(ROOT, "packages", "client", "dist", "cli.js"))});
await import(${JSON.stringify(join(ROOT, "packages", "client", "dist", "interactive-mode.js"))});
console.log((process.memoryUsage().rss / 1048576).toFixed(1));
`;
	const serverScript = `
await import(${JSON.stringify(join(ROOT, "packages", "server", "dist", "index.js"))});
console.log((process.memoryUsage().rss / 1048576).toFixed(1));
`;
	const clients = [];
	const servers = [];
	for (let run = 0; run < options.runs; run++) {
		clients.push(measure(options.runtime, clientScript));
		servers.push(measure(options.runtime, serverScript));
	}
	const client = median(clients);
	const server = median(servers);
	console.log("Resident memory (MB, median of " + options.runs + ")");
	console.log(`  client: ${client.toFixed(1)}`);
	console.log(`  server: ${server.toFixed(1)}`);
	console.log(`  total:  ${(client + server).toFixed(1)}`);
	return { client, server, total: client + server };
}

/**
 * The resident memory of the two live processes.
 */
function reportLive(options) {
	const binary = options.binary || join(ROOT, "packages", "client", "dist", "cli.js");
	const launch = binary.endsWith(".js") ? `${options.runtime} ${binary}` : binary;
	const session = "pi-profile";
	const dir = mkdtempSync(join(tmpdir(), "pi-profile-"));
	const agentDir = join(dir, "agent");
	const project = join(dir, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(project, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
	if (options.extensions > 0) {
		const extensions = join(agentDir, "extensions");
		mkdirSync(extensions, { recursive: true });
		const names = ["message-renderer.ts", "custom-header.ts", "widget-placement.ts"].slice(0, options.extensions);
		for (const name of names) cpSync(join(EXAMPLES, name), join(extensions, name));
	}
	const command = `cd ${project} && PI_CODING_AGENT_DIR=${agentDir} PI_OFFLINE=1 ${launch}`;
	try {
		execFileSync("tmux", ["kill-session", "-t", session], { stdio: "ignore" });
	} catch {
		// No session to kill.
	}
	execFileSync("tmux", ["new-session", "-d", "-s", session, "-x", "120", "-y", "40", command]);
	try {
		execFileSync("sleep", ["12"]);
		const listing = execFileSync("ps", ["-o", "pid=,ppid=,rss=,command=", "-ax"], { encoding: "utf8" });
		const rows = listing
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.filter((line) => !line.includes("tmux"))
			.map((line) => {
				const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
				return match ? { pid: match[1], ppid: match[2], rss: Number(match[3]), command: match[4] } : undefined;
			})
			.filter((row) => row !== undefined);
		const client = rows.find(
			(row) => row.command.includes(binary) && !row.command.includes("pi-server") && !row.command.startsWith("tmux"),
		);
		// The server is a process of its own only when the client does not host it.
		const server = rows.find(
			(row) =>
				!row.command.startsWith("tmux") &&
				row.pid !== client?.pid &&
				(row.command.includes("pi-server") || /server\/(src|dist)\/cli\.ts/.test(row.command)),
		);
		const clientMb = client ? client.rss / 1024 : 0;
		const serverMb = server ? server.rss / 1024 : 0;
		console.log("Live memory (MB)");
		console.log(`  client: ${clientMb.toFixed(1)}`);
		console.log(`  server: ${serverMb.toFixed(1)}`);
		console.log(`  total:  ${(clientMb + serverMb).toFixed(1)}`);
		return { client: clientMb, server: serverMb, total: clientMb + serverMb };
	} finally {
		try {
			execFileSync("tmux", ["kill-session", "-t", session], { stdio: "ignore" });
		} catch {
			// The session is gone.
		}
		rmSync(dir, { recursive: true, force: true });
	}
}

const options = parseArgs(process.argv.slice(2));
if (options.graph) reportGraph();
reportMemory(options);
if (options.live) reportLive(options);
