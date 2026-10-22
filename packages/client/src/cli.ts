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
import { parseArgs } from "@earendil-works/pi-coding-agent/cli/args";
import { setConfigSelector } from "@earendil-works/pi-coding-agent/cli/config-selector-host";
import { getAgentDir, readSelfInstallManifest, type SelfInstallManifest } from "@earendil-works/pi-coding-agent/config";
import type { CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent/core/agent-session-runtime";
import { SessionManager } from "@earendil-works/pi-coding-agent/core/session-manager";
import { SettingsManager } from "@earendil-works/pi-coding-agent/core/settings-manager";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent/core/trust-manager";
import { type InteractiveStartContext, main } from "@earendil-works/pi-coding-agent/main";
import { basicAuthHeader, PiServerClient, type SessionStateSnapshot } from "@earendil-works/pi-server/client";
import { RemoteSessionFacade } from "./remote-facade.ts";
import { ensureServer, isServerAlive, readServerRegistration } from "./server-launcher.ts";

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
		default:
			break;
	}
	registerConfigEditor();
	if (args.includes("--help") || args.includes("-h")) printClientCommands();
	await main(args, { onInteractive: startInteractive });
}

/** The commands the client adds to the ones of the coding agent. */
function printClientCommands(): void {
	console.log(`Client commands:
  pi serve               Start a pi server in the foreground
  pi pair                Print the LAN url and a pairing code
  pi service status      Show the registered server
  pi service stop        Stop the registered server
  pi ${SELF_INSTALL_COMMAND}            Build the standalone binary and link it into a PATH directory
`);
}

/**
 * Register the interactive config editor with the coding agent.
 *
 * The editor is a terminal UI, so it is loaded when the command runs, not at startup.
 */
function registerConfigEditor(): void {
	setConfigSelector(async (options) => {
		const { selectConfig } = await import("./cli/config-selector.ts");
		await selectConfig(options);
	});
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
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const password = stringFlag(flags, "password") ?? randomBytes(16).toString("base64url");
	const port = numberFlag(flags, "port") ?? settingsManager.getServerPort();
	const hostname = stringFlag(flags, "hostname") ?? settingsManager.getServerHostname();
	const idleTimeoutMs = numberFlag(flags, "idle-timeout-ms") ?? settingsManager.getServerIdleTimeoutMs();

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
		createRuntime: await createServerRuntimeFactory(agentDir, settingsManager),
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

Builds the pi client as a standalone binary and links it into a directory on your PATH.

Options:
  --dir <dir>       The directory the binary and its assets live in (default ~/.local/lib/pi)
  --bin-dir <dir>   The directory the pi symlink lives in (default ~/.local/bin)
  --offline         Build with the bundled model data instead of fetching it
  --no-build        Only refresh the links, do not build the binary
  --no-workspace-build
                    Do not build the workspace before building the binary
  --build-only      Build the binary, do not touch the links
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
export async function startInteractive(context: InteractiveStartContext): Promise<void> {
	await ensureProjectTrust(context);

	const server = await ensureServer({ agentDir: context.agentDir });
	const client = new PiServerClient({ url: server.url, password: server.password });
	const resume = await resolveResumeTarget(context);
	const snapshot = await openRemoteSession({
		url: server.url,
		password: server.password,
		cwd: context.cwd,
		sessionDir: context.sessionDir,
		title: context.parsed.name,
		model: context.parsed.model,
		thinkingLevel: context.parsed.thinking,
		resume,
	});

	const facade = new RemoteSessionFacade(client, snapshot.sessionId, snapshot.cwd || context.cwd, {
		agentDir: context.agentDir,
	});
	await facade.load();

	const { InteractiveMode } = await import("./interactive-mode.ts");
	const mode = new InteractiveMode(facade, {
		initialMessage: context.initialMessage,
		initialImages: context.initialImages,
		initialMessages: context.parsed.messages,
		verbose: context.parsed.verbose,
		tuiMode: context.parsed.tuiMode,
		initialThemeSetting: context.parsed.useTheme,
	});
	await mode.run();
}

/**
 * Ask for the project trust when the policy is "ask" and the trust store has no decision.
 *
 * The server never prompts. It reads the trust store, so the decision is written before
 * the session is opened.
 */
async function ensureProjectTrust(context: InteractiveStartContext): Promise<void> {
	if (context.settingsManager.getDefaultProjectTrust() !== "ask") return;
	const trustStore = new ProjectTrustStore(context.agentDir);
	if (trustStore.get(context.cwd) !== null) return;
	const trusted = await askYesNo(`Trust the project folder ${context.cwd}?`);
	trustStore.set(context.cwd, trusted);
}

/**
 * The session the command line asks for, as the server understands it.
 */
async function resolveResumeTarget(context: InteractiveStartContext): Promise<"recent" | string | undefined> {
	const target = context.parsed.session;
	if (target !== undefined) {
		if (target.endsWith(".jsonl") && existsSync(target)) return target;
		return SessionManager.findById(context.cwd, target, context.sessionDir) ?? target;
	}
	if (context.parsed.continue) return "recent";
	if (!context.parsed.resume) return undefined;
	return pickSessionPath(context.cwd, context.sessionDir);
}

/**
 * Ask which session to resume.
 */
async function pickSessionPath(cwd: string, sessionDir: string | undefined): Promise<string | undefined> {
	const sessions = await SessionManager.list(cwd, sessionDir);
	if (sessions.length === 0) {
		console.log("There is no session to resume.");
		return undefined;
	}
	console.log("Sessions:");
	for (const [index, session] of sessions.entries()) {
		const label = session.name ?? session.firstMessage ?? session.id;
		console.log(`  ${index + 1}) ${label}  ${session.path}`);
	}
	const answer = await askLine("Session number to resume (empty to cancel): ");
	const number = Number.parseInt(answer.trim(), 10);
	if (!Number.isFinite(number) || number < 1 || number > sessions.length) return undefined;
	return sessions[number - 1]?.path;
}

/**
 * The body of a session creation request.
 */
interface OpenSessionOptions {
	url: string;
	password: string;
	cwd: string;
	sessionDir: string | undefined;
	title: string | undefined;
	model: string | undefined;
	thinkingLevel: string | undefined;
	resume: "recent" | string | undefined;
}

/**
 * Open a session on the server.
 */
async function openRemoteSession(options: OpenSessionOptions): Promise<SessionStateSnapshot> {
	const body: Record<string, unknown> = { cwd: options.cwd };
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
		throw new Error(`The server refused to open the session: ${text}`);
	}
	const payload = (await response.json()) as { data: SessionStateSnapshot };
	return payload.data;
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
async function createServerRuntimeFactory(
	agentDir: string,
	settingsManager: SettingsManager,
): Promise<CreateAgentSessionRuntimeFactory> {
	const { createRuntimeFactory } = await import("@earendil-works/pi-coding-agent/core/runtime-factory");
	return createRuntimeFactory({
		agentDir,
		parsed: parseArgs([]),
		startupSettingsManager: settingsManager,
		trustStore: new ProjectTrustStore(agentDir),
		appMode: () => "interactive",
		trustPromptMode: "interactive",
		extensionFactories: [],
		projectTrustContextFactory: (cwd, mode, hasUI) => ({
			cwd,
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
