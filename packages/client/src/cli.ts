#!/usr/bin/env node
/**
 * The client entry point.
 *
 * The client is the pi terminal UI. It never hosts the agent runtime: it drives a pi
 * server over HTTP and SSE. This module wires the command line to that server: the
 * subcommands that manage the server process, and the interactive mode that drives a
 * session on it.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	accessSync,
	constants,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	type Stats,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, networkInterfaces } from "node:os";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent/core/agent-session-runtime";
import type { PiServer } from "@earendil-works/pi-server";
import {
	basicAuthHeader,
	type PiManifest,
	PiServerClient,
	type ServerHandshake,
	type SessionStateSnapshot,
} from "@earendil-works/pi-server/client";
import { normalizePath } from "@earendil-works/pi-support/paths";
import { ClientSettings } from "./client-settings.ts";
import {
	type Args,
	buildInitialMessage,
	type InitialMessageResult,
	normalizeSessionName,
	parseArgs,
	printHelp,
	readFileArguments,
} from "./client-support/args.ts";
import {
	ENV_SESSION_DIR,
	getAgentDir,
	readSelfInstallManifest,
	type SelfInstallManifest,
	VERSION,
} from "./client-support/config.ts";
import { setAvailableThemes, setThemeFromJson } from "./client-theme.ts";
import { RemoteSessionFacade } from "./remote-facade.ts";
import {
	ensureServer,
	isServerAlive,
	localServer,
	readServerRegistration,
	readServerSettings,
	readSettingsRecord,
} from "./server-launcher.ts";

/** The command that starts a server process. */
export const SERVER_COMMAND = "pi-server";

/**
 * The flag the bundle build defines. It tells the entry point that it is the process
 * entry, even when the bundle launcher is the file the user ran.
 */
declare const PI_BUNDLED_NODE: boolean | undefined;

/**
 * Run the client.
 *
 * The subcommands manage the server; everything else is the interactive client.
 */
export async function runClient(args: string[]): Promise<void> {
	const [command, ...rest] = args;
	switch (command) {
		case "serve":
			await runServe(rest);
			return;
		case "pair":
			await runPair(rest);
			return;
		case "service":
			await runService(rest);
			return;
		case SELF_INSTALL_COMMAND:
			await runSelfInstall(rest);
			return;
		case "config":
			await runConfig(rest);
			return;
		default:
			break;
	}

	const parsed = parseArgs(args);
	reportDiagnostics(parsed);
	if (parsed.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
		process.exitCode = 1;
		return;
	}
	if (parsed.help) {
		printClientCommands();
		printHelp();
		return;
	}
	if (parsed.version) {
		console.log(VERSION);
		return;
	}
	if (parsed.print || parsed.mode === "json") {
		process.exitCode = await runPrint(parsed);
		return;
	}
	if (parsed.mode === "rpc") {
		process.exitCode = await runRpc(parsed);
		return;
	}
	await startInteractive(parsed);
}

/**
 * The rpc mode.
 *
 * The commands arrive as JSON lines on the standard input, the answers and the events go
 * to the standard output. The runtime lives in the server, so the client hands the
 * commands over.
 */
async function runRpc(parsed: Args): Promise<number> {
	const agentDir = getAgentDir();
	const server = await ensureServer({ agentDir });
	const client = new PiServerClient({ url: server.url, password: server.password });
	const handshake = await client.handshake();
	await ensureProjectTrust(client, handshake);
	const cwd = handshake.cwd;

	const snapshot = await openRemoteSession({
		url: server.url,
		password: server.password,
		sessionDir: resolveSessionDir(parsed),
		title: parsed.name === undefined ? undefined : normalizeSessionName(parsed.name),
		model: parsed.model,
		thinkingLevel: parsed.thinking,
		resume: await resolveResumeTarget(client, parsed, cwd, agentDir),
	});

	const { runRpcMode } = await import("./rpc-mode.ts");
	return runRpcMode(client, snapshot.sessionId);
}

/**
 * The print mode.
 *
 * The client is a renderer, so a headless run is a run of the server: the client starts
 * the server, opens the session, sends the prompt and prints the answer of the model.
 *
 * The server runs in this process: a one-shot run needs a runtime, and a runtime of its
 * own in a second process would cost the memory of a second copy of the agent.
 */
async function runPrint(parsed: Args): Promise<number> {
	const agentDir = getAgentDir();
	const server = await startLocalServer(agentDir);
	try {
		const client = new PiServerClient({ url: server.url, password: server.password });
		const handshake = await client.handshake();
		await ensureProjectTrust(client, handshake);
		const cwd = handshake.cwd;

		const snapshot = await openRemoteSession({
			url: server.url,
			password: server.password,
			sessionDir: resolveSessionDir(parsed),
			title: parsed.name === undefined ? undefined : normalizeSessionName(parsed.name),
			model: parsed.model,
			thinkingLevel: parsed.thinking,
			resume: await resolveResumeTarget(client, parsed, cwd, agentDir),
		});

		if (!(await checkManifest(client, snapshot.sessionId, agentDir, handshake.trust.trusted))) {
			return 1;
		}

		const { initialMessage, initialImages } = await buildInitialMessageFor(parsed);
		const messages = initialMessage === undefined ? [...parsed.messages] : [initialMessage, ...parsed.messages];
		if (messages.length === 0) {
			process.stderr.write("There is nothing to send. Give a prompt with -p.\n");
			return 1;
		}

		const { runPrintMode } = await import("./print-mode.ts");
		return await runPrintMode(client, snapshot.sessionId, {
			mode: parsed.mode === "json" ? "json" : "text",
			messages,
			initialImages,
		});
	} finally {
		await server.close();
	}
}

/**
 * Start a server in this process.
 *
 * The server runtime is the whole agent runtime, so it is loaded here and not at the top
 * of the module: the interactive client never needs it.
 */
async function startLocalServer(agentDir: string): Promise<PiServer> {
	const cwd = process.cwd();
	const _serverSettings = readServerSettings(cwd, agentDir);
	const password = randomBytes(16).toString("base64url");
	const { startServer } = await import("@earendil-works/pi-server");
	return startServer({
		hostname: "127.0.0.1",
		port: 0,
		password,
		agentDir,
		cwd,
		idleTimeoutMs: 0,
		createRuntime: await createServerRuntimeFactory(agentDir, cwd),
	});
}

/** The commands the client adds to the ones of the coding agent. */
function printClientCommands(): void {
	console.log(`Client commands:
  pi serve               Start a pi server in the foreground
  pi pair                Print the LAN url and a pairing code
  pi service status      Show the registered server
  pi service stop        Stop the registered server
  pi config              Open the TUI that enables and disables package resources
  pi ${SELF_INSTALL_COMMAND}        Build the standalone binary and link it into a PATH directory
`);
}

/**
 * Report the problems of the command line.
 */
function reportDiagnostics(parsed: Args): void {
	for (const diagnostic of parsed.diagnostics) {
		console.error(`${diagnostic.type === "error" ? "Error" : "Warning"}: ${diagnostic.message}`);
	}
}

/**
 * The `pi config` command.
 *
 * The resources belong to the server: it resolves them and it writes the settings that
 * enable them. The client draws the editor and hands the changes over.
 */
async function runConfig(args: string[]): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: pi config [-l]

Opens the editor that enables and disables the resources of the server.

Options:
  -l, --local         Write to the project scope instead of the global one
`);
		return;
	}
	const local = args.includes("-l") || args.includes("--local");
	const agentDir = getAgentDir();
	const server = await ensureServer({ agentDir });
	const client = new PiServerClient({ url: server.url, password: server.password });
	const handshake = await client.handshake();
	await ensureProjectTrust(client, handshake);
	const cwd = handshake.cwd;

	const changes: Promise<unknown>[] = [];
	const settings = new ClientSettings({
		scopes: { global: readSettingsRecord(cwd, agentDir) },
		projectTrusted: handshake.trust.trusted,
		onChange: (key, value, scope) => {
			changes.push(client.setSetting(key, value, undefined, scope));
		},
	});

	const { selectConfig } = await import("./cli/config-selector.ts");
	await selectConfig({
		resolvedPaths: await client.paths(),
		settingsManager: settings,
		cwd,
		agentDir,
		writeScope: local ? "project" : "global",
		projectModeAvailable: handshake.trust.trusted,
	});
	await settings.flush();
	await Promise.all(changes);
}

/**
 * Start the server in the foreground and stay alive until the process is asked to stop.
 *
 * The server runtime is loaded here and not at the top of the module: the interactive
 * client never needs it, and the server package carries the whole agent runtime.
 */
async function runServe(args: string[]): Promise<void> {
	const flags = parseFlags(args);
	const agentDir = stringFlag(flags, "agent-dir") ?? getAgentDir();
	const cwd = process.cwd();
	const serverSettings = readServerSettings(cwd, agentDir);
	const password = stringFlag(flags, "password") ?? randomBytes(16).toString("base64url");
	const port = numberFlag(flags, "port") ?? serverSettings.port;
	const hostname = stringFlag(flags, "hostname") ?? serverSettings.hostname;
	const idleTimeoutMs = numberFlag(flags, "idle-timeout-ms") ?? serverSettings.idleTimeoutMs;

	const exited = Promise.withResolvers<void>();

	// The server runtime is the whole agent runtime: only "pi serve" needs it, so the
	// interactive client never loads it.
	const { startServer } = await import("@earendil-works/pi-server");
	const server = await startServer({
		hostname,
		port,
		password,
		agentDir,
		cwd,
		idleTimeoutMs,
		createRuntime: await createServerRuntimeFactory(agentDir, cwd),
		onIdle: () => exited.resolve(),
	});

	console.log(`server listening on ${server.url}`);
	console.log(`server password ${password}`);

	await Promise.race([exited.promise, waitForSignal()]);
	await server.close();
}

/**
 * Print the LAN url, a pairing code and the url that redeems it.
 */
async function runPair(args: string[]): Promise<void> {
	const flags = parseFlags(args);
	const agentDir = stringFlag(flags, "agent-dir") ?? getAgentDir();
	const registration = readServerRegistration(agentDir);
	if (!registration) {
		throw new Error(`No pi server is registered for ${agentDir}. Start one with "${SERVER_COMMAND}".`);
	}
	if (!(await isServerAlive(registration))) {
		throw new Error(`The registered pi server (pid ${registration.pid}) is not running.`);
	}
	const code = await requestPairingCode(registration.url);
	const url = lanUrlFor(registration.url);
	console.log(`LAN url: ${url}`);
	console.log(`pairing code: ${code}`);
	console.log(`open: ${url}/auth/connect/${code}`);
}

/**
 * Report on the registered server, or stop it.
 */
async function runService(args: string[]): Promise<void> {
	const [action, ...rest] = args;
	const flags = parseFlags(rest);
	const agentDir = stringFlag(flags, "agent-dir") ?? getAgentDir();
	const registration = readServerRegistration(agentDir);
	if (!registration) {
		console.log(`No pi server is registered for ${agentDir}.`);
		return;
	}
	if (action === "stop") {
		try {
			process.kill(registration.pid, "SIGTERM");
		} catch (error) {
			throw new Error(`The pi server (pid ${registration.pid}) could not be stopped: ${describe(error)}`);
		}
		console.log(`Sent SIGTERM to the pi server (pid ${registration.pid}).`);
		return;
	}
	if (action !== undefined && action !== "status") {
		console.log("Usage: pi service [status|stop]");
		return;
	}
	const alive = await isServerAlive(registration);
	console.log(`url: ${registration.url}`);
	console.log(`pid: ${registration.pid}`);
	console.log(`alive: ${alive ? "yes" : "no"}`);
}

// =============================================================================
// Self install
// =============================================================================

/** The command that builds the standalone binary and links it into a PATH directory. */
export const SELF_INSTALL_COMMAND = "self-install";

/** Whether the client runs on Windows, which needs a command shim instead of a symlink. */
const IS_WINDOWS = process.platform === "win32";

/** The name of the standalone client binary. */
const BINARY_NAME = IS_WINDOWS ? "pi.exe" : "pi";

/** The name of the standalone server binary. */
const SERVER_BINARY_NAME = IS_WINDOWS ? "pi-server.exe" : "pi-server";

/** The name of the link the shell finds. */
const LINK_NAME = IS_WINDOWS ? "pi.cmd" : "pi";

/** The name of the link the shell finds for the server. */
const SERVER_LINK_NAME = IS_WINDOWS ? "pi-server.cmd" : "pi-server";

/** The paths a self install writes. */
export interface SelfInstallPlan {
	/** The directory the binary and its runtime assets live in. */
	installDir: string;
	/** The directory the `pi` symlink lives in. */
	binDir: string;
	/** The standalone client binary. */
	binaryPath: string;
	/** The standalone server binary. */
	serverPath: string;
	/** The `pi` symlink. */
	linkPath: string;
	/** The `pi-server` symlink. */
	serverLinkPath: string;
}

/** The paths of a self install, with the defaults of the release layout. */
export function planSelfInstall(
	options: { installDir?: string; binDir?: string; home?: string } = {},
): SelfInstallPlan {
	const home = options.home ?? homedir();
	const installDir = options.installDir
		? resolve(expandPath(options.installDir, home))
		: join(home, ".local", "lib", "pi");
	const binDir = options.binDir ? resolve(expandPath(options.binDir, home)) : join(home, ".local", "bin");
	return {
		installDir,
		binDir,
		binaryPath: join(installDir, BINARY_NAME),
		serverPath: join(installDir, SERVER_BINARY_NAME),
		linkPath: join(binDir, LINK_NAME),
		serverLinkPath: join(binDir, SERVER_LINK_NAME),
	};
}

/** Expand a leading `~` in a path. */
function expandPath(path: string, home: string): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return join(home, path.slice(2));
	return path;
}

/**
 * Whether a path may be replaced by the install.
 *
 * The install only replaces what it created: a symlink into the install directory, or
 * nothing at all. A file it did not create is left alone unless the user forces it.
 */
export function checkReplaceable(path: string, installDir: string): { allowed: boolean; reason?: string } {
	let stats: Stats;
	try {
		stats = lstatSync(path);
	} catch {
		return { allowed: true };
	}
	if (stats.isSymbolicLink()) {
		const target = resolve(dirname(path), readlinkSync(path));
		if (target === installDir || target.startsWith(`${installDir}${sep}`)) return { allowed: true };
		return { allowed: false, reason: `it points at ${target}` };
	}
	return { allowed: false, reason: "it is a file that pi did not create" };
}

/** The usage of the self install command. */
function printSelfInstallUsage(): void {
	console.log(`Usage: pi ${SELF_INSTALL_COMMAND} [options]

Builds the pi client and the pi server as standalone binaries and links them into a
directory on your PATH, replacing the binaries an earlier install left there.

From a checkout, "make app" does the same and is the shorter way to say it.

Options:
  --dir <dir>       The directory the binaries and their assets live in (default ~/.local/lib/pi)
  --bin-dir <dir>   The directory the pi symlinks live in (default ~/.local/bin)
  --offline         Build with the bundled model data instead of fetching it
  --no-build        Only refresh the links, do not build the binaries
  --no-workspace-build
                    Do not build the workspace before building the binaries
  --build-only      Build the binaries, do not touch the links
  --force           Replace files that pi did not create
  -h, --help        Show this help
`);
}

/**
 * Build the client as a standalone binary and link it into a PATH directory.
 *
 * The binary is a single file that carries the client and the runtime it talks to, so the
 * `pi` on the PATH is the one that was just built.
 */
async function runSelfInstall(args: string[]): Promise<void> {
	const flags = parseFlags(args);
	if (flags.help) {
		printSelfInstallUsage();
		return;
	}
	const manifest = readSelfInstallManifest();
	const plan = planSelfInstall({
		installDir: stringFlag(flags, "dir") ?? manifest?.installDir,
		binDir: stringFlag(flags, "bin-dir") ?? manifest?.binDir,
	});
	const force = flags.force === true;
	const skipBuild = flags["no-build"] === true;
	const buildOnly = flags["build-only"] === true;

	if (!buildOnly) {
		for (const linkPath of [plan.linkPath, plan.serverLinkPath]) {
			const check = checkReplaceable(linkPath, plan.installDir);
			if (check.allowed || force) continue;
			throw new Error(
				`${linkPath} already exists and ${check.reason}. Remove it, choose another --bin-dir, or pass --force.`,
			);
		}
	}

	const sources = resolveSelfInstallSources(manifest);
	let version = sources.version;
	const hadBinary = existsSync(plan.binaryPath);
	if (!skipBuild) {
		version = await buildSelfInstall(plan, sources, {
			offline: flags.offline === true,
			buildWorkspace: flags["no-workspace-build"] !== true,
		});
	}

	if (!buildOnly) {
		mkdirSync(plan.installDir, { recursive: true });
		writeFileSync(
			join(plan.installDir, "install.json"),
			`${JSON.stringify(
				{
					installDir: plan.installDir,
					binDir: plan.binDir,
					...(sources.repoRoot ? { sourceDir: sources.repoRoot } : {}),
					version,
					installedAt: new Date().toISOString(),
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		mkdirSync(plan.binDir, { recursive: true });
		linkBinary(plan.binaryPath, plan.linkPath);
		linkBinary(plan.serverPath, plan.serverLinkPath);
	}

	console.log(`Installed pi ${version} to ${plan.binaryPath}`);
	if (hadBinary) console.log(`Replaced the binary that was at ${plan.binaryPath}`);
	if (!buildOnly) {
		console.log(`Linked ${plan.linkPath} -> ${relative(plan.binDir, plan.binaryPath)}`);
		console.log(`Linked ${plan.serverLinkPath} -> ${relative(plan.binDir, plan.serverPath)}`);
	}
	if (!isOnPath(plan.binDir)) {
		console.log();
		console.log(`${plan.binDir} is not on your PATH. Add it with:`);
		console.log(`  export PATH="${plan.binDir}:$PATH"`);
		console.log(`Add that line to your shell profile (~/.zshrc, ~/.bashrc) to keep it.`);
	}
	console.log();
	console.log(`To undo the install: rm ${plan.linkPath} ${plan.serverLinkPath} && rm -rf ${plan.installDir}`);
}

/** Whether a directory is on the PATH. */
function isOnPath(directory: string): boolean {
	const entries = (process.env.PATH ?? "").split(delimiter);
	return entries.some((entry) => entry.length > 0 && resolve(entry) === resolve(directory));
}

/** Link a binary into the PATH directory. */
function linkBinary(binaryPath: string, linkPath: string): void {
	try {
		unlinkSync(linkPath);
	} catch {
		// The link does not exist yet.
	}
	if (IS_WINDOWS) {
		const target = relative(dirname(linkPath), binaryPath).replaceAll("/", "\\");
		writeFileSync(linkPath, `@ECHO off\r\n"%~dp0${target}" %*\r\n`, "utf-8");
		return;
	}
	symlinkSync(relative(dirname(linkPath), binaryPath), linkPath);
}

/** The packages a self install builds from. */
interface SelfInstallSources {
	/** The repository root, when the install runs from a checkout. */
	repoRoot: string | undefined;
	/** The client package directory. */
	clientDir: string;
	/** The coding agent package directory. */
	codingAgentDir: string;
	/** The server package directory. */
	serverDir: string;
	/** The version of the client. */
	version: string;
}

/** Find the package directory of a package, by walking up from one of its files. */
function findPackageDir(startDir: string): string | undefined {
	let dir = startDir;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) return dir;
		dir = dirname(dir);
	}
	return undefined;
}

/** Find the package directory of an installed package. */
function resolveInstalledPackageDir(packageName: string): string | undefined {
	try {
		const require = createRequire(import.meta.url);
		return findPackageDir(dirname(require.resolve(packageName)));
	} catch {
		return undefined;
	}
}

/** Read the manifest of a package. */
function readPackageManifest(packageDir: string): { name?: string; version?: string } | undefined {
	try {
		return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf-8")) as { name?: string; version?: string };
	} catch {
		return undefined;
	}
}

/** Read the version of a package. */
function readPackageVersion(packageDir: string): string {
	return readPackageManifest(packageDir)?.version ?? "0.0.0";
}

/**
 * The packages the install builds from.
 *
 * A checkout builds the workspace; an installed package builds from the files it ships.
 * A binary that `pi self-install` built rebuilds from the checkout it was built from.
 */
function resolveSelfInstallSources(manifest: SelfInstallManifest | undefined): SelfInstallSources {
	const recordedRoot = manifest?.sourceDir && existsSync(manifest.sourceDir) ? manifest.sourceDir : undefined;
	const clientDir = recordedRoot
		? join(recordedRoot, "packages", "client")
		: (findPackageDir(dirname(fileURLToPath(import.meta.url))) ?? process.cwd());
	const repoRoot = recordedRoot ?? findRepoRoot(clientDir);
	if (repoRoot) {
		return {
			repoRoot,
			clientDir,
			codingAgentDir: join(repoRoot, "packages", "coding-agent"),
			serverDir: join(repoRoot, "packages", "server"),
			version: readPackageVersion(clientDir),
		};
	}
	const codingAgentDir = resolveInstalledPackageDir("@earendil-works/pi-coding-agent");
	const serverDir = resolveInstalledPackageDir("@earendil-works/pi-server");
	if (!codingAgentDir || !serverDir) {
		throw new Error(
			"The pi client and the pi server package are needed to build the binary. Install them next to the client.",
		);
	}
	return { repoRoot: undefined, clientDir, codingAgentDir, serverDir, version: readPackageVersion(clientDir) };
}

/** The repository root of a checkout, when the directory is part of one. */
function findRepoRoot(startDir: string): string | undefined {
	let dir = startDir;
	while (dir !== dirname(dir)) {
		const manifestPath = join(dir, "package.json");
		if (existsSync(manifestPath)) {
			try {
				const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { name?: string };
				if (manifest.name === "pi-monorepo") return dir;
			} catch {
				return undefined;
			}
		}
		dir = dirname(dir);
	}
	return undefined;
}

/** Run a command, failing the install when it does not succeed. */
function runInstallCommand(command: string, args: string[], cwd?: string): void {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.error) {
		throw new Error(`Could not run ${command}: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
	}
}

/**
 * Build the standalone binaries.
 *
 * The binaries carry the client and the server, so they run without the workspace and
 * without the packages they were built from.
 */
async function buildSelfInstall(
	plan: SelfInstallPlan,
	sources: SelfInstallSources,
	options: { offline: boolean; buildWorkspace: boolean },
): Promise<string> {
	const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf-8" });
	if (bunVersion.error || bunVersion.status !== 0) {
		throw new Error("Building the binary needs bun. Install it from https://bun.sh and run the command again.");
	}

	if (sources.repoRoot && options.buildWorkspace) {
		console.log(`Building the workspace in ${sources.repoRoot}...`);
		runInstallCommand("bun", ["run", options.offline ? "build:offline" : "build"], sources.repoRoot);
	}

	mkdirSync(plan.installDir, { recursive: true });
	const entryDir = resolveEntryDirectory(sources);
	const entryFiles: string[] = [];
	try {
		const clientEntry = writeEntryFile(entryDir, "pi-self-install-client-entry.mjs", [
			// A relative import: the bundler resolves a file url as a package specifier.
			'import "./runtime-setup.js";',
			// In a compiled binary every bundled module sees the executable as its
			// entry, so the client would start itself as well. Point argv at the
			// executable and import the client afterwards, so that it knows it is
			// not the entry and this file starts it once. A static import cannot
			// do this: imports are evaluated before the body of this file runs.
			'process.env.PI_CLIENT_EMBEDDED = "1";',
			"process.argv[1] = process.execPath;",
			`const { runClient, setupClient } = await import(${JSON.stringify(relativeEntryPath(entryDir, join(sources.clientDir, "dist", "cli.js")))});`,
			"setupClient();",
			"await runClient(process.argv.slice(2));",
		]);
		entryFiles.push(clientEntry);
		const serverEntry = writeEntryFile(entryDir, "pi-self-install-server-entry.mjs", [
			// A relative import: the bundler resolves a file url as a package specifier.
			'import "./runtime-setup.js";',
			// The server starts itself when it is the process entry, so the entry
			// claims the start. The import has to be dynamic: imports are
			// evaluated before the body of this file runs.
			'process.env.PI_CLIENT_EMBEDDED = "1";',
			"process.argv[1] = process.execPath;",
			`const { runCli } = await import(${JSON.stringify(relativeEntryPath(entryDir, join(sources.serverDir, "dist", "cli.js")))});`,
			"await runCli(process.argv.slice(2));",
		]);
		entryFiles.push(serverEntry);

		console.log(`Building ${plan.binaryPath}...`);
		runInstallCommand(
			"bun",
			[
				"build",
				"--compile",
				"--no-compile-autoload-bunfig",
				"--no-compile-autoload-dotenv",
				clientEntry,
				"--outfile",
				plan.binaryPath,
			],
			entryDir,
		);
		console.log(`Building ${plan.serverPath}...`);
		runInstallCommand(
			"bun",
			[
				"build",
				"--compile",
				"--no-compile-autoload-bunfig",
				"--no-compile-autoload-dotenv",
				serverEntry,
				...workerEntrypoints(sources),
				"--outfile",
				plan.serverPath,
			],
			entryDir,
		);
	} finally {
		for (const entryFile of entryFiles) {
			rmSync(entryFile, { force: true });
		}
	}

	copyRuntimeAssets(plan, sources);
	return readPackageVersion(sources.clientDir);
}

/**
 * The directory the generated entry points live in.
 *
 * Bun embeds the extra entry points of a binary relative to their common directory, and
 * the runtime looks the workers up by that path, so the entries live next to the coding
 * agent package.
 */
function resolveEntryDirectory(sources: SelfInstallSources): string {
	const candidate = join(sources.codingAgentDir, "dist", "bun");
	try {
		mkdirSync(candidate, { recursive: true });
		accessSync(candidate, constants.W_OK);
		return candidate;
	} catch {
		return sources.codingAgentDir;
	}
}

/**
 * The path of a file relative to the entry point, for the bundler.
 */
function relativeEntryPath(entryDir: string, file: string): string {
	const path = relative(entryDir, file);
	return path.startsWith(".") ? path : `./${path}`;
}

/**
 * Write an entry point for a binary.
 *
 * The entry lives in the coding agent package so that the workers the runtime spawns
 * keep the paths they are embedded under.
 */
function writeEntryFile(entryDir: string, name: string, lines: string[]): string {
	const entryPath = join(entryDir, name);
	writeFileSync(entryPath, `${lines.join("\n")}\n`, "utf-8");
	return entryPath;
}

/** The worker entry points the server binary embeds. */
function workerEntrypoints(sources: SelfInstallSources): string[] {
	const entries: string[] = [];
	for (const worker of ["src/extensions/codemode/worker.ts", "src/utils/image-resize-worker.ts"]) {
		const source = join(sources.codingAgentDir, worker);
		if (existsSync(source)) entries.push(source);
	}
	return entries;
}

/** Copy the runtime assets the binaries read next to the executable. */
function copyRuntimeAssets(plan: SelfInstallPlan, sources: SelfInstallSources): void {
	const themeSource = join(sources.codingAgentDir, "dist", "core", "theme");
	if (existsSync(themeSource)) {
		cpSync(themeSource, join(plan.installDir, "theme"), { recursive: true });
	}
	const exportSource = join(sources.codingAgentDir, "dist", "core", "export-html");
	if (existsSync(exportSource)) {
		cpSync(exportSource, join(plan.installDir, "export-html"), { recursive: true });
	}
	const clientAssets = [join(sources.clientDir, "dist", "assets"), join(sources.clientDir, "src", "assets")];
	for (const assets of clientAssets) {
		if (!existsSync(assets)) continue;
		cpSync(assets, join(plan.installDir, "assets"), { recursive: true });
		break;
	}
	cpSync(join(sources.clientDir, "package.json"), join(plan.installDir, "package.json"));
	// The system prompt points the model at the README next to the executable, so the
	// documentation of the runtime has to sit next to the binary.
	for (const document of ["README.md", "CHANGELOG.md"]) {
		const source = join(sources.codingAgentDir, document);
		if (existsSync(source)) cpSync(source, join(plan.installDir, document));
	}
	const wasm = resolvePhotonWasm(sources.codingAgentDir);
	if (wasm) cpSync(wasm, join(plan.installDir, "photon_rs_bg.wasm"));
	copyNativeHelpers(plan, sources);
}

/**
 * Copy the native terminal helpers next to the executable.
 *
 * A compiled binary has no packages to resolve the native module from, so the helper
 * has to sit next to it, in the layout the terminal UI looks for.
 */
function copyNativeHelpers(plan: SelfInstallPlan, sources: SelfInstallSources): void {
	const tuiDir = sources.repoRoot
		? join(sources.repoRoot, "packages", "tui")
		: resolveInstalledPackageDir("@earendil-works/pi-tui");
	if (!tuiDir) return;
	const platform = process.platform;
	const arch = process.arch;
	const source = join(tuiDir, "native", platform, "prebuilds", `${platform}-${arch}`);
	if (!existsSync(source)) return;
	cpSync(source, join(plan.installDir, "native", platform, "prebuilds", `${platform}-${arch}`), { recursive: true });
}

/** Find the native image helper that ships next to the coding agent. */
function resolvePhotonWasm(codingAgentDir: string): string | undefined {
	const built = join(codingAgentDir, "dist", "photon_rs_bg.wasm");
	if (existsSync(built)) return built;
	let dir = codingAgentDir;
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", "@silvia-odwyer", "photon-node", "photon_rs_bg.wasm");
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	return undefined;
}

/**
 * The interactive client.
 *
 * The server is headless, so the client asks for the project trust, finds the server,
 * opens the session on it and hands the session to the terminal UI.
 */
export async function startInteractive(parsed: Args): Promise<void> {
	const agentDir = getAgentDir();
	// A local run costs one runtime: the client runs the server in its own process, unless
	// the machine already has a server the client can join.
	const server = await localServer({ agentDir });
	try {
		await runInteractive(parsed, agentDir, server.url, server.password);
	} finally {
		await server.close?.();
	}
}

/**
 * Open the session and hand it to the terminal UI.
 */
async function runInteractive(parsed: Args, agentDir: string, url: string, password: string): Promise<void> {
	const client = new PiServerClient({ url, password });
	const handshake = await client.handshake();
	await ensureProjectTrust(client, handshake);
	const cwd = handshake.cwd;

	const resume = await resolveResumeTarget(client, parsed, cwd, agentDir);
	const snapshot = await openRemoteSession({
		url,
		password,
		sessionDir: resolveSessionDir(parsed),
		title: parsed.name === undefined ? undefined : normalizeSessionName(parsed.name),
		model: parsed.model,
		thinkingLevel: parsed.thinking,
		resume,
	});

	const facade = new RemoteSessionFacade(client, snapshot.sessionId, snapshot.cwd || cwd, {
		agentDir,
	});
	await facade.load();

	if (!(await checkManifest(client, snapshot.sessionId, agentDir, handshake.trust.trusted))) {
		return;
	}
	const manifest = await client.manifest(snapshot.sessionId);
	installServerThemes(manifest);

	const { initialMessage, initialImages } = await buildInitialMessageFor(parsed);
	const { InteractiveMode } = await import("./interactive-mode.ts");
	const mode = new InteractiveMode(facade, {
		initialMessage,
		initialImages,
		initialMessages: parsed.messages,
		verbose: parsed.verbose,
		tuiMode: parsed.tuiMode,
		initialThemeSetting: parsed.useTheme,
	});
	await mode.run();
}

/**
 * Check the extensions of the client against the server's manifest.
 *
 * The server loads the extensions; the client has the files on its own disk. When the two
 * do not agree, the client does not start the terminal UI: a client that draws half of a
 * session is worse than a client that says what is missing.
 *
 * @returns whether the two sides match.
 */
async function checkManifest(
	client: PiServerClient,
	sessionId: string,
	agentDir: string,
	projectTrusted: boolean,
): Promise<boolean> {
	const { ClientState } = await import("./client-state.ts");
	const { ManifestMismatchError } = await import("./manifest-check.ts");
	try {
		const manifest = await client.manifest(sessionId);
		const state = new ClientState({ manifest, agentDir, projectTrusted });
		state.assertExtensionsMatch();
		return true;
	} catch (error) {
		if (error instanceof ManifestMismatchError) {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = 1;
			return false;
		}
		// A server that cannot describe itself is not a mismatch the client can report.
		return true;
	}
}

/**
 * The first message of the session, with the files of the command line.
 */
async function buildInitialMessageFor(parsed: Args): Promise<InitialMessageResult> {
	if (parsed.fileArgs.length === 0) return buildInitialMessage({ parsed });
	const files = await readFileArguments(parsed.fileArgs);
	return buildInitialMessage({ parsed, fileText: files.text, fileImages: files.images });
}

/**
 * The directory the session file lives in.
 *
 * The flag wins over the environment, the way the coding agent resolves it.
 */
function resolveSessionDir(parsed: Args): string | undefined {
	if (parsed.sessionDir) return normalizePath(parsed.sessionDir);
	const fromEnvironment = process.env[ENV_SESSION_DIR];
	return fromEnvironment ? normalizePath(fromEnvironment) : undefined;
}

/**
 * Install the themes of the server.
 *
 * The themes belong to the server: it offers them in its manifest, so the client draws
 * with the theme of the server and knows the ones the theme picker offers.
 */
function installServerThemes(manifest: PiManifest): void {
	const themes = manifest.themes ?? [];
	setAvailableThemes(
		themes.map((entry) => ({ name: entry.name, path: undefined })),
		Object.fromEntries(themes.map((entry) => [entry.name, entry.json])),
	);
	setThemeFromJson(manifest.theme.json);
}

/**
 * Ask for the project trust when the project has resources that need trust and the trust
 * store has no decision.
 *
 * The server never prompts. It reads the trust store, so the decision is written before
 * the session is opened.
 */
async function ensureProjectTrust(client: PiServerClient, handshake: ServerHandshake): Promise<void> {
	const trust = handshake.trust;
	if (!trust.required || trust.decided) return;
	const trusted = await askYesNo(`Trust the project folder ${handshake.cwd}?`);
	await client.setTrust(handshake.cwd, trusted);
}

/**
 * The session the command line asks for, as the server understands it.
 */
async function resolveResumeTarget(
	client: PiServerClient,
	parsed: Args,
	cwd: string,
	agentDir: string,
): Promise<"recent" | string | undefined> {
	const target = parsed.session;
	if (target !== undefined) {
		if (target.endsWith(".jsonl") && existsSync(target)) return target;
		return findSessionPath(client, cwd, target);
	}
	if (parsed.continue) return "recent";
	if (!parsed.resume) return undefined;
	return pickSession(client, cwd, agentDir);
}

/**
 * The path of the session with an id.
 *
 * The server owns the sessions, so the client asks it for the list of the directory.
 */
async function findSessionPath(client: PiServerClient, cwd: string, id: string): Promise<string> {
	const sessions = await client.listSessions(cwd);
	const match = sessions.find((session) => session.id === id) ?? sessions.find((session) => session.id.startsWith(id));
	return match?.path ?? id;
}

/**
 * Ask which session to resume.
 */
async function pickSession(client: PiServerClient, cwd: string, agentDir: string): Promise<string | undefined> {
	const settings = new ClientSettings({ scopes: { global: readSettingsRecord(cwd, agentDir) } });
	const { selectSession } = await import("./cli/session-picker.ts");
	return (await selectSession(client, cwd, settings)) ?? undefined;
}

/**
 * The body of a session creation request.
 */
interface OpenSessionOptions {
	url: string;
	password: string;
	sessionDir: string | undefined;
	title: string | undefined;
	model: string | undefined;
	thinkingLevel: string | undefined;
	resume: "recent" | string | undefined;
}

/**
 * Open a session on the server.
 *
 * The body carries no working directory: the session runs in the directory of the server.
 */
async function openRemoteSession(options: OpenSessionOptions): Promise<SessionStateSnapshot> {
	const body: Record<string, unknown> = {};
	if (options.sessionDir !== undefined) body.sessionDir = options.sessionDir;
	if (options.title !== undefined) body.title = options.title;
	if (options.model !== undefined) body.model = options.model;
	if (options.thinkingLevel !== undefined) body.thinkingLevel = options.thinkingLevel;
	if (options.resume !== undefined) body.resume = options.resume;

	const response = await fetch(`${options.url}/pi/session`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: basicAuthHeader(options.password) },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const text = await response.text();
		throw sessionError(text);
	}
	const payload = (await response.json()) as { data: SessionStateSnapshot };
	return payload.data;
}

/**
 * The server refused to open the session because the project is not trusted.
 *
 * The server sends the message and the directory it refused, so the client says what the
 * server said and stops.
 */
export class ProjectNotTrustedError extends Error {
	/** The directory the server refused. */
	readonly cwd: string | undefined;

	constructor(message: string, cwd: string | undefined) {
		super(message);
		this.name = "ProjectNotTrustedError";
		this.cwd = cwd;
	}
}

/**
 * The error of a session the server refused.
 */
function sessionError(text: string): Error {
	try {
		const body = JSON.parse(text) as { _tag?: string; message?: string; cwd?: string };
		if (body._tag === "ProjectNotTrustedError") {
			return new ProjectNotTrustedError(
				body.message ?? "The project folder is not trusted.",
				typeof body.cwd === "string" ? body.cwd : undefined,
			);
		}
	} catch {}
	return new Error(`The server refused to open the session: ${text}`);
}

/**
 * Ask the server for a pairing code.
 */
async function requestPairingCode(url: string): Promise<string> {
	try {
		const response = await fetch(`${url}/api/pair`, { method: "POST" });
		if (response.ok) {
			const body = (await response.json()) as { code?: string };
			if (body.code) return body.code;
		}
	} catch {}
	// The server owns the pairing codes: a code the server does not know cannot be
	// redeemed, so there is nothing the client could offer instead.
	throw new Error("The server did not hand out a pairing code.");
}

/**
 * The url of the server on the local network.
 */
function lanUrlFor(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	const address = lanAddress();
	if (!address) return url;
	return `http://${address}:${parsed.port || "80"}`;
}

/**
 * The first non-internal IPv4 address of this machine.
 */
function lanAddress(): string | undefined {
	for (const addresses of Object.values(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family !== "IPv4" || address.internal) continue;
			return address.address;
		}
	}
	return undefined;
}

/**
 * The runtime factory the foreground server uses.
 *
 * The factory builds the agent runtime, so it is loaded with the server: the interactive
 * client never needs it.
 */
async function createServerRuntimeFactory(agentDir: string, cwd: string): Promise<CreateAgentSessionRuntimeFactory> {
	const [{ createRuntimeFactory }, { SettingsManager }, { ProjectTrustStore }] = await Promise.all([
		import("@earendil-works/pi-coding-agent/core/runtime-factory"),
		import("@earendil-works/pi-coding-agent/core/settings-manager"),
		import("@earendil-works/pi-coding-agent/core/trust-manager"),
	]);
	return createRuntimeFactory({
		agentDir,
		parsed: parseArgs([]),
		startupSettingsManager: SettingsManager.create(cwd, agentDir),
		trustStore: new ProjectTrustStore(agentDir),
		appMode: () => "interactive",
		trustPromptMode: "interactive",
		extensionFactories: [],
		projectTrustContextFactory: (trustCwd, mode, hasUI) => ({
			cwd: trustCwd,
			mode: mode === "interactive" ? "tui" : mode,
			hasUI,
			ui: {
				select: async (_title, options) => options[0],
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
		}),
	});
}

/**
 * Wait for a termination signal.
 */
async function waitForSignal(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	process.once("SIGINT", () => resolve());
	process.once("SIGTERM", () => resolve());
	await promise;
}

/**
 * Ask a yes or no question.
 */
async function askYesNo(question: string): Promise<boolean> {
	const answer = await askLine(`${question} [y/N] `);
	return /^y(es)?$/i.test(answer.trim());
}

/**
 * Ask for a line of input.
 */
async function askLine(question: string): Promise<string> {
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const { promise, resolve } = Promise.withResolvers<string>();
		readline.question(question, resolve);
		return await promise;
	} finally {
		readline.close();
	}
}

/**
 * Parse the flags of a subcommand.
 */
function parseFlags(args: string[]): Record<string, string | boolean> {
	const flags: Record<string, string | boolean> = {};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg?.startsWith("--")) continue;
		const name = arg.slice(2);
		const value = args[index + 1];
		if (value !== undefined && !value.startsWith("--")) {
			flags[name] = value;
			index++;
		} else {
			flags[name] = true;
		}
	}
	return flags;
}

/**
 * The value of a flag that takes one.
 */
function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
	const value = flags[name];
	return typeof value === "string" ? value : undefined;
}

/**
 * The value of a flag that takes a number.
 */
function numberFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
	const value = stringFlag(flags, name);
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The message of an error.
 */
function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Whether this module is the entry point of the process.
 */
function isProcessEntry(): boolean {
	// A generated entry point starts the client itself.
	if (process.env.PI_CLIENT_EMBEDDED === "1") return false;
	if (typeof PI_BUNDLED_NODE !== "undefined") return PI_BUNDLED_NODE === true;
	const entry = process.argv[1];
	if (entry === undefined) return false;
	if (import.meta.url === pathToFileURL(entry).href) return true;
	try {
		return import.meta.url === pathToFileURL(realpathSync(entry)).href;
	} catch {
		return false;
	}
}

/**
 * Prepare the process for the client.
 */
export function setupClient(): void {
	process.title = "pi";
	process.env.PI_CODING_AGENT = "true";
	process.env.AI_AGENT = "pi";
	declareBinaryOwner();
	pointAtSiblingServer();
}

/**
 * Tell the runtime which package owns the running binary.
 *
 * The self update has to update the package that ships the `pi` binary. A bundled or a
 * compiled binary does not say where it came from, so the client names itself.
 */
function declareBinaryOwner(): void {
	const packageDir = findPackageDir(dirname(fileURLToPath(import.meta.url)));
	if (!packageDir) return;
	const manifest = readPackageManifest(packageDir);
	if (!manifest?.name) return;
	process.env.PI_BINARY_PACKAGE = manifest.name;
	process.env.PI_BINARY_PACKAGE_DIR = packageDir;
	if (manifest.version) process.env.PI_BINARY_PACKAGE_VERSION = manifest.version;
}

/**
 * Point the client at the server binary that sits next to it.
 *
 * A standalone binary has no packages to resolve the server from, so it starts the
 * `pi-server` binary that `pi self-install` put next to it.
 */
function pointAtSiblingServer(): void {
	if (process.env.PI_SERVER_COMMAND?.trim()) return;
	// Only a compiled binary needs this: an installed package resolves the server from
	// its node_modules.
	if (!import.meta.url.includes("$bunfs") && !import.meta.url.includes("~BUN")) return;
	const sibling = join(dirname(process.execPath), SERVER_BINARY_NAME);
	if (!existsSync(sibling)) return;
	// The server takes a free port, so that two clients do not fight over one.
	process.env.PI_SERVER_COMMAND = `${sibling} --port 0`;
}

if (isProcessEntry()) {
	setupClient();
	runClient(process.argv.slice(2)).catch((error: unknown) => {
		console.error(describe(error));
		process.exitCode = 1;
	});
}
