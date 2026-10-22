/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 */

import { createInterface } from "node:readline";
import type { ImageContent } from "@earendil-works/pi-ai";
import { setCapabilityOverrides } from "@earendil-works/pi-tui/terminal-capabilities";
import chalk from "chalk";
import { type Args, type Mode, normalizeSessionName, parseArgs, printHelp } from "./cli/args.ts";
import type { AuthCheckResult } from "./cli/auth-check.ts";
import {
	type AuthCommand,
	AuthCommandError,
	getAuthCommandName,
	getAuthCommandUsage,
	isAuthCommandHelp,
	parseAuthCommand,
	printAuthCommandHelp,
	validateAuthCommandArgs,
} from "./cli/auth-command.ts";
import { buildInitialMessage } from "./cli/initial-message.ts";
import { createTuiProjectTrustContext } from "./cli/project-trust-tui.ts";
import { APP_NAME, ENV_SESSION_DIR, expandTildePath, getAgentDir, getPackageDir, VERSION } from "./config.ts";
import type { CreateAgentSessionRuntimeFactory } from "./core/agent-session-runtime.ts";
import type { AgentSessionRuntimeDiagnostic } from "./core/agent-session-services.ts";
import { formatNoModelsAvailableMessage } from "./core/auth-guidance.ts";
import type { InlineExtension } from "./core/extensions/types.ts";
import { applyHttpProxySettings, configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { cleanupManagedInstall } from "./core/managed-install.ts";
import { restoreStdout, takeOverStdout } from "./core/output-guard.ts";
import { isConfigCommand, isPackageCommand } from "./core/package-commands.ts";
import type { AppMode } from "./core/project-trust.ts";
import {
	formatMissingSessionCwdPrompt,
	getMissingSessionCwdIssue,
	MissingSessionCwdError,
	type SessionCwdIssue,
} from "./core/session-cwd.ts";
import { assertValidSessionId, SessionManager } from "./core/session-manager.ts";
import { collectSettingsDiagnostics, deduplicateDiagnostics } from "./core/settings-diagnostics.ts";
import { SettingsManager } from "./core/settings-manager.ts";
import { initTheme, setThemeJsonValidator, stopThemeWatcher } from "./core/theme/theme.ts";
import { validateThemeJson } from "./core/theme/theme-schema.ts";
import { printTimings, resetTimings, time } from "./core/timings.ts";
import { ProjectTrustStore } from "./core/trust-manager.ts";
import { loadMcpCommand } from "./extensions/mcp/cli.lazy.ts";
import { runMigrations, showDeprecationWarnings } from "./migrations.ts";
import { loadPackageManagerCli } from "./package-manager-cli.lazy.ts";
import { isLocalPath, normalizePath, resolvePath } from "./utils/paths.ts";
import { cleanupWindowsSelfUpdateQuarantine } from "./utils/windows-self-update.ts";

const EXTENSION_LOAD_FAILURE_HINT = `Hint: Start without extensions using "${APP_NAME} -ne".`;

/**
 * Read all content from piped stdin.
 * Returns undefined if stdin is a TTY (interactive terminal).
 */
async function readPipedStdin(): Promise<string | undefined> {
	// If stdin is a TTY, we're running interactively - don't read stdin
	if (process.stdin.isTTY) {
		return undefined;
	}

	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => {
			resolve(data.trim() || undefined);
		});
		process.stdin.resume();
	});
}

function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
	for (const diagnostic of diagnostics) {
		const color = diagnostic.type === "error" ? chalk.red : diagnostic.type === "warning" ? chalk.yellow : chalk.dim;
		const prefix = diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
		console.error(color(`${prefix}${diagnostic.message}`));
	}
}

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function resolveAppMode(parsed: Args, stdinIsTTY: boolean, stdoutIsTTY: boolean): AppMode {
	if (parsed.mode === "rpc") {
		return "rpc";
	}
	if (parsed.mode === "json") {
		return "json";
	}
	if (parsed.print || !stdinIsTTY || !stdoutIsTTY) {
		return "print";
	}
	return "interactive";
}

function toPrintOutputMode(appMode: AppMode): Exclude<Mode, "rpc"> {
	return appMode === "json" ? "json" : "text";
}

function isPlainRuntimeMetadataCommand(parsed: Args): boolean {
	return !parsed.print && parsed.mode === undefined && (parsed.help === true || parsed.listModels !== undefined);
}

async function runAuthCommand(args: string[]): Promise<boolean> {
	if (isAuthCommandHelp(args)) {
		printAuthCommandHelp();
		return true;
	}

	let command: AuthCommand | undefined;
	try {
		command = parseAuthCommand(args);
	} catch (error) {
		const message = error instanceof AuthCommandError ? error.message : "Failed to parse auth command";
		console.error(chalk.red(`Error: ${message}`));
		process.exitCode = 1;
		return true;
	}
	if (!command) return false;

	const parsed = parseArgs(command.args);
	if (parsed.unknownFlags.size > 0) {
		const option = parsed.unknownFlags.keys().next().value;
		console.error(chalk.red(`Unknown option --${option} for "${getAuthCommandName(command.kind)}".`));
		console.error(chalk.dim(`Use "${APP_NAME} --help" or "${getAuthCommandUsage(command.kind)}".`));
		process.exitCode = 1;
		return true;
	}
	try {
		if (parsed.diagnostics.length > 0) {
			throw new AuthCommandError(parsed.diagnostics.map((d) => d.message).join("\n"));
		}
		if (command.kind !== "check") {
			const signal = AbortSignal.timeout(15_000);
			// The model runtime and the credential printer are only needed by this command,
			// so they load here instead of at startup.
			const [{ ModelRuntime }, { resolveCredentialForPrint }] = await Promise.all([
				import("./core/model-runtime.ts"),
				import("./cli/credential-print.ts"),
			]);
			const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false, signal });
			const credential = await resolveCredentialForPrint(
				parsed,
				modelRuntime,
				command.kind,
				command.minExpiryMs,
				signal,
			);
			process.stdout.write(`${credential}\n`);
			return true;
		}

		const requestedAuth = validateAuthCommandArgs(parsed, command.kind);
		let result: AuthCheckResult;
		let credential: string | undefined;
		try {
			const [
				{ checkProviderAuth, createAuthCheckModelRuntime, getProviderCredential },
				{ AuthStorage, ReadOnlyAuthStorage },
			] = await Promise.all([import("./cli/auth-check.ts"), import("./core/auth-storage.ts")]);
			const credentials = command.noRefresh ? new ReadOnlyAuthStorage() : AuthStorage.create();
			const modelRuntime = await createAuthCheckModelRuntime(credentials);
			result = await checkProviderAuth(parsed, modelRuntime, { refresh: !command.noRefresh });
			if (command.credentials && result.status === "ready") {
				credential = await getProviderCredential(result.provider, modelRuntime, credentials, {
					refresh: !command.noRefresh,
				});
				if (!credential) {
					result = { status: "not_ready", provider: result.provider, reason: "credential_not_available" };
				}
			}
		} catch {
			result = {
				status: "invalid",
				provider: requestedAuth.provider ?? requestedAuth.model!,
				reason: "invalid_state",
			};
		}
		const output = command.json
			? JSON.stringify({ ...result, ...(credential ? { credentials: credential } : {}) })
			: (credential ?? result.status);
		process.stdout.write(`${output}\n`);
		process.exitCode = result.status === "ready" ? 0 : result.status === "not_ready" ? 1 : 2;
	} catch (error) {
		const message = error instanceof AuthCommandError ? error.message : "Failed to resolve credential";
		console.error(chalk.red(`Error: ${message}`));
		process.exitCode = command.kind === "check" ? 2 : 1;
	}
	return true;
}

async function prepareInitialMessage(
	parsed: Args,
	stdinContent?: string,
): Promise<{
	initialMessage?: string;
	initialImages?: ImageContent[];
}> {
	if (parsed.fileArgs.length === 0) {
		return buildInitialMessage({ parsed, stdinContent });
	}

	// AgentSession resizes these after extension hooks select the request model.
	const { processFileArguments } = await import("./cli/file-processor.ts");
	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages: false });
	return buildInitialMessage({
		parsed,
		fileText: text,
		fileImages: images,
		stdinContent,
	});
}

/** Result from resolving a session argument */
type ResolvedSession =
	| { type: "path"; path: string } // Direct file path
	| { type: "local"; path: string } // Found in current project
	| { type: "global"; path: string; cwd: string } // Found in different project
	| { type: "not_found"; arg: string }; // Not found anywhere

/**
 * Resolve a session argument to a file path.
 * If it looks like a path, use as-is. Otherwise try to match as session ID prefix.
 */
function findLocalSessionByExactId(
	sessionId: string,
	cwd: string,
	sessionDir?: string,
): { type: "local"; path: string } | undefined {
	const path = SessionManager.findById(cwd, sessionId, sessionDir);
	return path ? { type: "local", path } : undefined;
}

async function resolveSessionPath(sessionArg: string, cwd: string, sessionDir?: string): Promise<ResolvedSession> {
	// If it looks like a file path, resolve it before handing it to the session manager.
	if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
		return { type: "path", path: resolvePath(sessionArg, cwd) };
	}

	// Exact IDs only require reading session headers. Fall back to the full
	// metadata listing for prefix matches.
	const exactLocalMatch = findLocalSessionByExactId(sessionArg, cwd, sessionDir);
	if (exactLocalMatch) {
		return exactLocalMatch;
	}

	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatch = localSessions.find((s) => s.id.startsWith(sessionArg));

	if (localMatch) {
		return { type: "local", path: localMatch.path };
	}

	// Try global search across all projects
	const allSessions = await SessionManager.listAll(sessionDir);
	const globalMatch =
		allSessions.find((s) => s.id === sessionArg) ?? allSessions.find((s) => s.id.startsWith(sessionArg));

	if (globalMatch) {
		return { type: "global", path: globalMatch.path, cwd: globalMatch.cwd };
	}

	// Not found anywhere
	return { type: "not_found", arg: sessionArg };
}

/** Prompt user for yes/no confirmation */
async function promptConfirm(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${message} [y/N] `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}

function validateForkFlags(parsed: Args): void {
	if (!parsed.fork) return;

	const conflictingFlags = [
		parsed.session ? "--session" : undefined,
		parsed.continue ? "--continue" : undefined,
		parsed.resume ? "--resume" : undefined,
		parsed.noSession ? "--no-session" : undefined,
	].filter((flag): flag is string => flag !== undefined);

	if (conflictingFlags.length > 0) {
		console.error(chalk.red(`Error: --fork cannot be combined with ${conflictingFlags.join(", ")}`));
		process.exit(1);
	}
}

function validateSessionIdFlags(parsed: Args): void {
	if (parsed.sessionId === undefined) return;

	const conflictingFlags = [
		parsed.session ? "--session" : undefined,
		parsed.continue ? "--continue" : undefined,
		parsed.resume ? "--resume" : undefined,
	].filter((flag): flag is string => flag !== undefined);

	if (conflictingFlags.length > 0) {
		console.error(chalk.red(`Error: --session-id cannot be combined with ${conflictingFlags.join(", ")}`));
		process.exit(1);
	}

	try {
		assertValidSessionId(parsed.sessionId);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

function openSessionOrExit(path: string, sessionDir?: string): SessionManager {
	try {
		return SessionManager.open(path, sessionDir);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

function forkSessionOrExit(sourcePath: string, cwd: string, sessionDir?: string, sessionId?: string): SessionManager {
	try {
		return SessionManager.forkFrom(sourcePath, cwd, sessionDir, { id: sessionId });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

export async function createSessionManager(
	parsed: Args,
	cwd: string,
	sessionDir: string | undefined,
	handleResume = true,
): Promise<SessionManager> {
	if (parsed.noSession || parsed.help || parsed.listModels !== undefined) {
		return SessionManager.inMemory(cwd, parsed.sessionId !== undefined ? { id: parsed.sessionId } : undefined);
	}

	if (parsed.fork) {
		if (parsed.sessionId) {
			const existingTarget = findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
			if (existingTarget) {
				console.error(chalk.red(`Session already exists with id '${parsed.sessionId}'`));
				process.exit(1);
			}
		}

		const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir);

		switch (resolved.type) {
			case "path":
			case "local":
			case "global":
				return forkSessionOrExit(resolved.path, cwd, sessionDir, parsed.sessionId);

			case "not_found":
				console.error(chalk.red(`No session found matching '${resolved.arg}'`));
				process.exit(1);
		}
	}

	if (parsed.session) {
		const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir);

		switch (resolved.type) {
			case "path":
			case "local":
				return openSessionOrExit(resolved.path, sessionDir);

			case "global": {
				console.log(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
				const shouldFork = await promptConfirm("Fork this session into current directory?");
				if (!shouldFork) {
					console.log(chalk.dim("Aborted."));
					process.exit(0);
				}
				return forkSessionOrExit(resolved.path, cwd, sessionDir);
			}

			case "not_found":
				console.error(chalk.red(`No session found matching '${resolved.arg}'`));
				process.exit(1);
		}
	}

	if (parsed.resume) {
		if (!handleResume) {
			// The client owns the session picker; it opens the picked session on the server.
			return SessionManager.create(cwd, sessionDir);
		}
		// Without a terminal there is nothing to pick with, so the most recent session
		// is continued. The client owns the picker and opens the picked session itself.
		return SessionManager.continueRecent(cwd, sessionDir);
	}

	if (parsed.continue) {
		return SessionManager.continueRecent(cwd, sessionDir);
	}

	if (parsed.sessionId) {
		const existingSession = findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
		if (existingSession) {
			return SessionManager.open(existingSession.path, sessionDir);
		}
		console.error(
			chalk.yellow(
				`Warning: No project session found with id '${parsed.sessionId}'; creating a new session with that id.`,
			),
		);
	}

	return SessionManager.create(cwd, sessionDir, { id: parsed.sessionId });
}

function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] | undefined {
	return paths?.map((value) => (isLocalPath(value) ? resolvePath(value, cwd) : value));
}

/**
 * The directory to use when a session's own directory is gone.
 *
 * This package has no terminal of its own any more, so there is nothing to ask with: the
 * fallback directory is used and the client asks the user when it opens the session.
 */
function resolveMissingSessionCwd(issue: SessionCwdIssue): string {
	console.error(chalk.yellow(formatMissingSessionCwdPrompt(issue)));
	return issue.fallbackCwd;
}

export interface MainOptions {
	extensionFactories?: InlineExtension[];
	/**
	 * Starts the interactive mode.
	 *
	 * The interactive mode lives in the client package, which drives a server over HTTP.
	 * The client passes its bootstrap here; without it, the interactive mode is not
	 * available in this package.
	 */
	onInteractive?: (context: InteractiveStartContext) => Promise<void>;
}

/** What the interactive mode needs to start. */
export interface InteractiveStartContext {
	/** The raw command line. */
	args: string[];
	/** The parsed command line. */
	parsed: Args;
	/** The working directory. */
	cwd: string;
	/** The agent directory. */
	agentDir: string;
	/** The session directory, when one is configured. */
	sessionDir: string | undefined;
	/** The settings manager of the startup directory. */
	settingsManager: SettingsManager;
	/** The initial message to send on startup. */
	initialMessage?: string;
	/** The images to attach to the initial message. */
	initialImages?: ImageContent[];
}

export async function main(args: string[], options?: MainOptions) {
	resetTimings();
	// Commands and startup selectors can load user-authored themes before runtime creation.
	setThemeJsonValidator(validateThemeJson);
	// The built-in extensions carry the whole extension runtime, so they load when a
	// command or a session needs them and not at startup.
	let extensionFactoriesPromise: Promise<InlineExtension[]> | undefined;
	const loadExtensionFactories = (): Promise<InlineExtension[]> => {
		extensionFactoriesPromise ??= import("./extensions/index.ts").then(({ builtInExtensions }) => [
			...builtInExtensions,
			...(options?.extensionFactories ?? []),
		]);
		return extensionFactoriesPromise;
	};
	const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env.PI_OFFLINE);
	if (offlineMode) {
		process.env.PI_OFFLINE = "1";
		process.env.PI_SKIP_VERSION_CHECK = "1";
	}

	if (await runAuthCommand(args)) {
		return;
	}

	if (process.platform === "win32") {
		cleanupWindowsSelfUpdateQuarantine(getPackageDir());
	}
	cleanupManagedInstall();

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher();

	if (isPackageCommand(args)) {
		const handled = await (await loadPackageManagerCli()).handlePackageCommand(args, {
			extensionFactories: await loadExtensionFactories(),
		});
		if (handled) {
			const exitCode = process.exitCode ?? 0;
			if (process.platform === "win32" && exitCode === 0 && args[0] === "update") {
				// We normally prefer process.exit(0) for package commands so bad extensions cannot keep
				// one-shot commands alive. On Windows, Node can assert after fetch() if process.exit(0)
				// runs during teardown; let successful `pi update` drain naturally instead.
				// https://github.com/nodejs/node/issues/56645
				return;
			}
			process.exit(exitCode);
			return;
		}
	}

	if (
		isConfigCommand(args) &&
		(await (
			await loadPackageManagerCli()
		).handleConfigCommand(args, {
			extensionFactories: await loadExtensionFactories(),
		}))
	) {
		return;
	}

	if (args[0] === "mcp") {
		const { runMcpCommand } = await loadMcpCommand();
		process.exitCode = await runMcpCommand(args.slice(1), { cwd, agentDir });
		return;
	}

	const parsed = parseArgs(args);
	if (parsed.diagnostics.length > 0) {
		for (const d of parsed.diagnostics) {
			const color = d.type === "error" ? chalk.red : chalk.yellow;
			console.error(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
		}
		if (parsed.diagnostics.some((d) => d.type === "error")) {
			process.exit(1);
		}
	}
	time("parseArgs");

	if (parsed.version) {
		console.log(VERSION);
		process.exit(0);
	}

	if (parsed.export) {
		let result: string;
		try {
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			const { exportFromFile } = await import("./core/export-html/index.ts");
			result = await exportFromFile(parsed.export, outputPath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			console.error(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
		console.log(`Exported to: ${result}`);
		process.exit(0);
	}

	let appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
	// The client package owns the terminal and the session: it drives a server over HTTP.
	// In that path this package does not create a runtime, does not prompt for anything
	// and hands the start context to the client.
	const interactiveClient =
		appMode === "interactive" &&
		options?.onInteractive !== undefined &&
		!parsed.help &&
		parsed.listModels === undefined;
	const shouldTakeOverStdout = appMode !== "interactive" && !isPlainRuntimeMetadataCommand(parsed);
	if (shouldTakeOverStdout) {
		takeOverStdout();
	}

	if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
		console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	validateForkFlags(parsed);
	validateSessionIdFlags(parsed);

	// Run migrations (pass cwd for project-local migrations)
	const { deprecationWarnings } = runMigrations(cwd);
	time("runMigrations");

	const startupSettingsManager = SettingsManager.create(cwd, agentDir);
	const startupSettingsDiagnostics = collectSettingsDiagnostics(startupSettingsManager);

	// Experimental first-time setup: theme choice and analytics opt-in.
	// Runs before any runtime services are created so the chosen settings apply everywhere.
	if (appMode === "interactive" && parsed.useTheme !== undefined) {
		startupSettingsManager.applyOverrides({ theme: parsed.useTheme });
	}

	// Decide the final runtime cwd before creating cwd-bound runtime services.
	// --session and --resume may select a session from another project, so project-local
	// settings, resources, provider registrations, and models must be resolved only after
	// the target session cwd is known. The startup-cwd settings manager is used only for
	// sessionDir lookup during session selection.
	const envSessionDir = process.env[ENV_SESSION_DIR];
	const sessionDir =
		(parsed.sessionDir ? normalizePath(parsed.sessionDir) : undefined) ??
		(envSessionDir ? expandTildePath(envSessionDir) : undefined) ??
		startupSettingsManager.getSessionDir();
	let sessionManager = await createSessionManager(parsed, cwd, sessionDir, !interactiveClient);
	const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
	if (missingSessionCwdIssue) {
		if (appMode === "interactive") {
			const selectedCwd = resolveMissingSessionCwd(missingSessionCwdIssue);
			sessionManager = SessionManager.open(missingSessionCwdIssue.sessionFile!, sessionDir, selectedCwd);
		} else {
			console.error(chalk.red(new MissingSessionCwdError(missingSessionCwdIssue).message));
			process.exit(1);
		}
	}
	if (parsed.name !== undefined) {
		const name = normalizeSessionName(parsed.name);
		if (name === undefined) {
			console.error(chalk.red("Error: --name requires a non-empty value"));
			process.exit(1);
		}
		sessionManager.appendSessionInfo(name);
	}
	time("createSessionManager");

	const trustStore = new ProjectTrustStore(agentDir);
	const trustPromptMode: AppMode = parsed.help || parsed.listModels !== undefined ? "print" : appMode;

	const resolvedExtensionPaths = resolveCliPaths(cwd, parsed.extensions);
	const resolvedSkillPaths = resolveCliPaths(cwd, parsed.skills);
	const resolvedPromptTemplatePaths = resolveCliPaths(cwd, parsed.promptTemplates);
	const resolvedThemePaths = resolveCliPaths(cwd, parsed.themes);
	if (interactiveClient) {
		// The client owns the terminal and the session: it starts a server, opens a
		// session there and drives it. This package hands over the start context.
		// The runtime is never created here, so the runtime graph stays unloaded.
		setCapabilityOverrides(startupSettingsManager.getTerminalCapabilityOverrides());
		applyHttpProxySettings(startupSettingsManager.getGlobalSettings().httpProxy);
		configureHttpDispatcher(startupSettingsManager.getHttpIdleTimeoutMs());
		initTheme(startupSettingsManager.getTheme(), true);
		const { initialMessage, initialImages } = await prepareInitialMessage(parsed, undefined);
		printTimings();
		await options!.onInteractive!({
			args,
			parsed,
			cwd: sessionManager.getCwd(),
			agentDir,
			sessionDir,
			settingsManager: startupSettingsManager,
			initialMessage,
			initialImages,
		});
		return;
	}

	// The runtime graph is the heavy part of the CLI: it loads only when a mode
	// actually creates a session.
	const [{ createRuntimeFactory }, { createAgentSessionRuntime }] = await Promise.all([
		import("./core/runtime-factory.ts"),
		import("./core/agent-session-runtime.ts"),
	]);
	const createRuntime: CreateAgentSessionRuntimeFactory = createRuntimeFactory({
		agentDir,
		parsed,
		startupSettingsManager,
		trustStore,
		appMode: () => appMode,
		trustPromptMode,
		extensionFactories: await loadExtensionFactories(),
		resolvedExtensionPaths,
		resolvedSkillPaths,
		resolvedPromptTemplatePaths,
		resolvedThemePaths,
		projectTrustContextFactory: (trustCwd, mode, hasUI) =>
			createTuiProjectTrustContext({ cwd: trustCwd, mode, settingsManager: startupSettingsManager, hasUI }),
	});

	time("createRuntime");
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: sessionManager.getCwd(),
		agentDir,
		sessionManager,
	});
	time("createAgentSessionRuntime");
	const { services, session } = runtime;
	const { settingsManager, modelRuntime, resourceLoader } = services;
	setCapabilityOverrides(settingsManager.getTerminalCapabilityOverrides());
	applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher(settingsManager.getHttpIdleTimeoutMs());

	if (parsed.help) {
		reportDiagnostics(startupSettingsDiagnostics);
		const extensionFlags = resourceLoader
			.getExtensions()
			.extensions.flatMap((extension) => Array.from(extension.flags.values()));
		printHelp(extensionFlags);
		process.exit(0);
	}

	if (parsed.listModels !== undefined) {
		reportDiagnostics(startupSettingsDiagnostics);
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		const { listModels } = await import("./cli/list-models.ts");
		await listModels(modelRuntime, searchPattern, AbortSignal.timeout(15_000));
		process.exit(0);
	}

	// Read piped stdin content (if any) - skip for RPC mode which uses stdin for JSON-RPC
	let stdinContent: string | undefined;
	if (appMode !== "rpc") {
		stdinContent = await readPipedStdin();
		if (stdinContent !== undefined && appMode === "interactive") {
			appMode = "print";
		}
	}
	time("readPipedStdin");

	const { initialMessage, initialImages } = await prepareInitialMessage(parsed, stdinContent);
	time("prepareInitialMessage");
	initTheme(settingsManager.getTheme(), appMode === "interactive");
	time("initTheme");

	// Show deprecation warnings in interactive mode
	if (appMode === "interactive" && deprecationWarnings.length > 0) {
		await showDeprecationWarnings(deprecationWarnings);
	}

	time("resolveModelScope");
	const startupDiagnostics = deduplicateDiagnostics([...startupSettingsDiagnostics, ...runtime.diagnostics]);
	const hasRuntimeErrors = runtime.diagnostics.some((diagnostic) => diagnostic.type === "error");
	if (appMode !== "interactive" || hasRuntimeErrors) {
		reportDiagnostics(startupDiagnostics);
	}
	if (hasRuntimeErrors) {
		if (runtime.diagnostics.some((diagnostic) => diagnostic.message.includes("Failed to load extension"))) {
			console.error(chalk.yellow(EXTENSION_LOAD_FAILURE_HINT));
		}
		process.exit(1);
	}
	time("createAgentSession");

	if (appMode !== "interactive" && !session.model) {
		console.error(chalk.red(formatNoModelsAvailableMessage()));
		process.exit(1);
	}

	const startupBenchmark = isTruthyEnvFlag(process.env.PI_STARTUP_BENCHMARK);
	if (startupBenchmark && appMode !== "interactive") {
		console.error(chalk.red("Error: PI_STARTUP_BENCHMARK only supports interactive mode"));
		process.exit(1);
	}

	// RPC refreshes catalogs here in the background; interactive mode starts its refresh after TUI initialization.
	if (!offlineMode && appMode === "rpc") {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		void modelRuntime
			.refresh({ signal: controller.signal })
			.catch(() => {})
			.finally(() => clearTimeout(timeout));
	}

	if (appMode === "rpc") {
		printTimings();
		const { runRpcMode } = await import("./modes/rpc/rpc-mode.ts");
		await runRpcMode(runtime);
	} else if (appMode === "interactive") {
		// The terminal interface lives in the client package, which drives a server over
		// HTTP. It asks this package for the start context and takes it from there.
		if (!options?.onInteractive) {
			console.error(chalk.red("Error: interactive mode requires @earendil-works/pi-client"));
			process.exit(1);
		}
		printTimings();
		await options.onInteractive({
			args,
			parsed,
			cwd: sessionManager.getCwd(),
			agentDir,
			sessionDir,
			settingsManager: startupSettingsManager,
		});
	} else {
		printTimings();
		const { runPrintMode } = await import("./modes/print-mode.ts");
		const exitCode = await runPrintMode(runtime, {
			mode: toPrintOutputMode(appMode),
			messages: parsed.messages,
			initialMessage,
			initialImages,
		});
		stopThemeWatcher();
		restoreStdout();
		if (exitCode !== 0) {
			process.exitCode = exitCode;
		}
		return;
	}
}
