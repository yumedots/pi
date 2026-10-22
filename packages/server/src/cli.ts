#!/usr/bin/env node
/**
 * The `pi-server` binary.
 *
 * It starts the server in the foreground, writes the registration file so a client can
 * find it, and shuts down cleanly on a signal.
 */

import { randomBytes } from "node:crypto";
import {
	builtInExtensions,
	createRuntimeFactory,
	getAgentDir,
	ProjectTrustStore,
	parseArgs,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { startServer } from "./server.ts";

/** The parsed command line. */
interface CliOptions {
	hostname?: string;
	port?: number;
	agentDir?: string;
	password?: string;
	idleTimeoutMs?: number;
	cwd?: string;
	remote: boolean;
	help: boolean;
}

/**
 * Parse the command line.
 */
export function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = { help: false, remote: false };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		switch (arg) {
			case "--help":
			case "-h":
				options.help = true;
				break;
			case "--hostname":
				options.hostname = args[++index];
				break;
			case "--port":
				options.port = Number(args[++index]);
				break;
			case "--agent-dir":
				options.agentDir = args[++index];
				break;
			case "--password":
				options.password = args[++index];
				break;
			case "--idle-timeout-ms":
				options.idleTimeoutMs = Number(args[++index]);
				break;
			case "--cwd":
				options.cwd = args[++index];
				break;
			case "--remote":
				options.remote = true;
				break;
			default:
				break;
		}
	}
	return options;
}

const USAGE = `Usage: pi-server [options]

Options:
  --hostname <host>     The interface to bind (default 0.0.0.0, which listens on every interface)
  --port <port>         The port to bind (default 4096, 0 picks a free port)
  --agent-dir <dir>     The agent directory (default the pi agent directory)
  --password <secret>   The password clients authenticate with (default: generated)
  --idle-timeout-ms <ms> How long the server stays up without a connected client (default 600000, 0 disables it)
  --cwd <dir>          The working directory of the server
  --remote             Expose the server to the internet through an opentunnel tunnel
  -h, --help            Show this help
`;

/**
 * Whether a hostname is the loopback address of the machine.
 */
function isLoopbackHostname(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

/**
 * Run the server CLI.
 */
export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
	const options = parseCliOptions(args);
	if (options.help) {
		console.log(USAGE);
		return;
	}

	const password = options.password ?? randomBytes(24).toString("hex");
	const agentDir = options.agentDir ?? getAgentDir();
	const cwd = options.cwd ?? process.cwd();

	const parsed = parseArgs([]);
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const createRuntime = createRuntimeFactory({
		agentDir,
		parsed,
		startupSettingsManager: settingsManager,
		trustStore: new ProjectTrustStore(agentDir),
		appMode: () => "rpc",
		trustPromptMode: "rpc",
		extensionFactories: builtInExtensions,
		projectTrustContextFactory: (trustCwd) => ({
			cwd: trustCwd,
			mode: "rpc",
			hasUI: false,
			ui: {
				select: async () => undefined,
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
		}),
	});

	const hostname = options.hostname || settingsManager.getServerHostname();
	const server = await startServer({
		hostname,
		port: options.port,
		password,
		agentDir,
		cwd,
		createRuntime,
		// A server that starts after a crash picks the interrupted work up again.
		resumeInterrupted: true,
		remote: options.remote,
		idleTimeoutMs: options.idleTimeoutMs ?? settingsManager.getServerIdleTimeoutMs(),
		onIdle: () => {
			process.exit(0);
		},
	});

	console.log(`server listening on ${server.url}`);
	console.log(`server password ${password}`);
	for (const url of server.urls) {
		if (url === server.url) continue;
		console.log(`server address ${url}`);
	}
	if (server.tunnel) {
		if (server.tunnel.ok) {
			console.log(`server tunnel ${server.tunnel.url}`);
		} else {
			console.log(`server tunnel unavailable: ${server.tunnel.reason ?? "it did not come up"}`);
		}
	}
	// A server that only listens on the loopback address is not reachable from a
	// device on the network, so it says so instead of leaving the user to guess.
	if (isLoopbackHostname(hostname)) {
		console.log("the server only listens on the loopback address, so no other device can reach it.");
		console.log("start it with --hostname 0.0.0.0 to pair a phone.");
	}

	let closing = false;
	const shutdown = () => {
		if (closing) return;
		closing = true;
		void server.close().then(() => process.exit(0));
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

// A generated entry point starts the server itself.
if (process.env.PI_CLIENT_EMBEDDED !== "1" && import.meta.url === `file://${process.argv[1]}`) {
	runCli().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
