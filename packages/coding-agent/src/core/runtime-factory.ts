/**
 * Runtime factory shared by the CLI and the server.
 *
 * The factory owns the per-cwd runtime creation chain: cwd-bound services, model resolution,
 * session options and the session itself. The CLI and the server both build sessions through
 * it, so a session behaves the same no matter which process hosts it.
 */

import { type Model, modelsAreEqual } from "@earendil-works/pi-ai";
import type { Args } from "../cli/args.ts";
import type { CreateAgentSessionRuntimeFactory } from "./agent-session-runtime.ts";
import {
	type AgentSessionRuntimeDiagnostic,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./agent-session-services.ts";
import type { InlineExtension, ProjectTrustContext } from "./extensions/types.ts";
import { resolveCliModel, resolveModelScope, type ScopedModel } from "./model-resolver.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import { type AppMode, resolveProjectTrusted } from "./project-trust.ts";
import type { CreateAgentSessionOptions } from "./sdk.ts";
import { collectSettingsDiagnostics } from "./settings-diagnostics.ts";
import { SettingsManager } from "./settings-manager.ts";
import { hasTrustRequiringProjectResources, type ProjectTrustStore } from "./trust-manager.ts";

/**
 * Inputs for {@link createRuntimeFactory}.
 */
export interface RuntimeFactoryOptions {
	/** The agent directory that holds auth, models and settings. */
	agentDir: string;
	/** Parsed CLI flags. The server passes the defaults. */
	parsed: Args;
	/** Settings manager of the startup directory, used for the trust policy and diagnostics. */
	startupSettingsManager: SettingsManager;
	/** The shared trust store. */
	trustStore: ProjectTrustStore;
	/** The mode the host runs in. Read lazily, because the CLI can switch modes at runtime. */
	appMode: () => AppMode;
	/** The mode used when the trust prompt needs a UI. */
	trustPromptMode: AppMode;
	/** Extension factories loaded for every session. */
	extensionFactories: InlineExtension[];
	/** Absolute extension paths from the CLI. */
	resolvedExtensionPaths?: string[];
	/** Absolute skill paths from the CLI. */
	resolvedSkillPaths?: string[];
	/** Absolute prompt template paths from the CLI. */
	resolvedPromptTemplatePaths?: string[];
	/** Absolute theme paths from the CLI. */
	resolvedThemePaths?: string[];
	/**
	 * Builds the context used to ask for project trust.
	 *
	 * A headless host passes a context without a UI, so an undecided project is refused
	 * instead of prompting.
	 */
	projectTrustContextFactory: (cwd: string, mode: AppMode, hasUI: boolean) => ProjectTrustContext;
}

/**
 * Resolve the session options for one session from the CLI flags and the scoped models.
 */
export function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	hasExistingSession: boolean,
	modelRuntime: ModelRuntime,
	settingsManager: SettingsManager,
): {
	options: CreateAgentSessionOptions;
	cliThinkingFromModel: boolean;
	diagnostics: AgentSessionRuntimeDiagnostic[];
} {
	const options: CreateAgentSessionOptions = {};
	const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
	let cliThinkingFromModel = false;

	// Model from CLI
	// - supports --provider <name> --model <pattern>
	// - supports --model <provider>/<pattern>
	if (parsed.provider && !parsed.model) {
		diagnostics.push({
			type: "error",
			message: `--provider requires --model (for example: --provider ${parsed.provider} --model <pattern>)`,
		});
	}
	if (parsed.model) {
		const resolved = resolveCliModel({
			cliProvider: parsed.provider,
			cliModel: parsed.model,
			cliThinking: parsed.thinking,
			inlineApiKey: Boolean(parsed.apiKey),
			modelRuntime,
		});
		if (resolved.warning) {
			diagnostics.push({ type: "warning", message: resolved.warning });
		}
		if (resolved.error) {
			diagnostics.push({ type: "error", message: resolved.error });
		}
		if (resolved.model) {
			options.model = resolved.model;
			// Allow "--model <pattern>:<thinking>" as a shorthand.
			// Explicit --thinking still takes precedence (applied later).
			if (!parsed.thinking && resolved.thinkingLevel) {
				options.thinkingLevel = resolved.thinkingLevel;
				cliThinkingFromModel = true;
			}
		}
	}

	if (!options.model && scopedModels.length > 0 && !hasExistingSession) {
		// Check if saved default is in scoped models - use it if so, otherwise first scoped model
		const savedProvider = settingsManager.getDefaultProvider();
		const savedModelId = settingsManager.getDefaultModel();
		const savedModel = savedProvider && savedModelId ? modelRuntime.getModel(savedProvider, savedModelId) : undefined;
		const savedInScope = savedModel ? scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel)) : undefined;

		if (savedInScope) {
			options.model = savedInScope.model;
			// Use thinking level from scoped model config if explicitly set
			if (!parsed.thinking && savedInScope.thinkingLevel) {
				options.thinkingLevel = savedInScope.thinkingLevel;
			}
		} else {
			options.model = scopedModels[0].model;
			// Use thinking level from first scoped model if explicitly set
			if (!parsed.thinking && scopedModels[0].thinkingLevel) {
				options.thinkingLevel = scopedModels[0].thinkingLevel;
			}
		}
	}

	// Thinking level from CLI (takes precedence over scoped model thinking levels set above)
	if (parsed.thinking) {
		options.thinkingLevel = parsed.thinking;
	}

	// Scoped models for Ctrl+P cycling
	// Keep thinking level undefined when not explicitly set in the model pattern.
	// Undefined means "inherit current session thinking level" during cycling.
	if (scopedModels.length > 0) {
		options.scopedModels = scopedModels.map((sm) => ({
			model: sm.model,
			thinkingLevel: sm.thinkingLevel,
		}));
	}

	// API key from CLI - set as a non-persistent runtime override
	// (handled by caller before createAgentSession)

	// Tools
	if (parsed.noTools) {
		options.noTools = "all";
	} else if (parsed.noBuiltinTools) {
		options.noTools = "builtin";
	}
	if (parsed.tools) {
		options.tools = [...parsed.tools];
	}
	if (parsed.excludeTools) {
		options.excludeTools = [...parsed.excludeTools];
	}

	return { options, cliThinkingFromModel, diagnostics };
}

/**
 * Create the runtime factory used to build agent sessions.
 *
 * The returned factory has the shape the CLI passes to `createAgentSessionRuntime`, so the
 * server reuses the whole creation chain instead of duplicating it.
 */
export function createRuntimeFactory(options: RuntimeFactoryOptions): CreateAgentSessionRuntimeFactory {
	const {
		agentDir,
		parsed,
		startupSettingsManager,
		trustStore,
		appMode,
		trustPromptMode,
		extensionFactories,
		resolvedExtensionPaths,
		resolvedSkillPaths,
		resolvedPromptTemplatePaths,
		resolvedThemePaths,
		projectTrustContextFactory,
	} = options;

	const projectTrustByCwd = new Map<string, boolean>();

	return async ({ cwd, agentDir: runtimeAgentDir, sessionManager, sessionStartEvent, projectTrustContext }) => {
		const effectiveAgentDir = runtimeAgentDir ?? agentDir;
		const isInitialRuntime = sessionStartEvent === undefined;
		const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
		const cachedProjectTrust = projectTrustByCwd.get(cwd);
		const hasTrustRequiringResources = hasTrustRequiringProjectResources(cwd);
		const shouldResolveProjectTrust =
			parsed.projectTrustOverride === undefined && cachedProjectTrust === undefined && hasTrustRequiringResources;
		const projectTrusted = shouldResolveProjectTrust
			? false
			: (cachedProjectTrust ??
				parsed.projectTrustOverride ??
				(!hasTrustRequiringResources || trustStore.get(cwd) === true));
		const runtimeSettingsManager = SettingsManager.create(cwd, effectiveAgentDir, { projectTrusted });
		const services = await createAgentSessionServices({
			cwd,
			agentDir: effectiveAgentDir,
			settingsManager: runtimeSettingsManager,
			modelRuntimeSignal: AbortSignal.timeout(15_000),
			extensionFlagValues: parsed.unknownFlags,
			resourceLoaderReloadOptions: shouldResolveProjectTrust
				? {
						resolveProjectTrust: async ({ extensionsResult }) => {
							const trusted = await resolveProjectTrusted({
								cwd,
								trustStore,
								trustOverride: parsed.projectTrustOverride,
								defaultProjectTrust: startupSettingsManager.getDefaultProjectTrust(),
								extensionsResult,
								projectTrustContext:
									projectTrustContext ??
									projectTrustContextFactory(
										cwd,
										isInitialRuntime ? trustPromptMode : appMode(),
										isInitialRuntime && trustPromptMode === "interactive",
									),
								onExtensionError: (message: string) =>
									projectTrustDiagnostics.push({ type: "warning", message }),
							});
							projectTrustByCwd.set(cwd, trusted);
							return trusted;
						},
					}
				: undefined,
			resourceLoaderOptions: {
				additionalExtensionPaths: resolvedExtensionPaths,
				additionalSkillPaths: resolvedSkillPaths,
				additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
				additionalThemePaths: resolvedThemePaths,
				noExtensions: parsed.noExtensions,
				disabledBuiltinExtensions: parsed.noMcp ? ["mcp"] : undefined,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				noContextFiles: parsed.noContextFiles,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
				extensionFactories,
			},
		});
		const { settingsManager, modelRuntime, resourceLoader } = services;
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...projectTrustDiagnostics,
			...services.diagnostics,
			...collectSettingsDiagnostics(settingsManager),
			...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
				type: "error" as const,
				message: `Failed to load extension "${path}": ${error}`,
			})),
			...(resourceLoader.getExtensions().warnings ?? []).map(({ path, warning }) => ({
				type: "warning" as const,
				message: `Extension package "${path}": ${warning}`,
			})),
		];

		const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
		const scopedModels =
			modelPatterns && modelPatterns.length > 0
				? await resolveModelScope(modelPatterns, modelRuntime, { signal: AbortSignal.timeout(15_000) })
				: [];
		const {
			options: sessionOptions,
			cliThinkingFromModel,
			diagnostics: sessionOptionDiagnostics,
		} = buildSessionOptions(
			parsed,
			scopedModels,
			sessionManager.buildSessionContext().messages.length > 0,
			modelRuntime,
			settingsManager,
		);
		diagnostics.push(...sessionOptionDiagnostics);

		if (parsed.apiKey) {
			if (!sessionOptions.model) {
				diagnostics.push({
					type: "error",
					message: "--api-key requires a model to be specified via --model, --provider/--model, or --models",
				});
			} else {
				await modelRuntime.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
			}
		}

		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model: sessionOptions.model,
			thinkingLevel: sessionOptions.thinkingLevel,
			scopedModels: sessionOptions.scopedModels,
			tools: sessionOptions.tools,
			excludeTools: sessionOptions.excludeTools,
			noTools: sessionOptions.noTools,
			customTools: sessionOptions.customTools,
		});
		const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
		if (created.session.model && cliThinkingOverride) {
			created.session.setThinkingLevel(created.session.thinkingLevel);
		}

		return {
			...created,
			services,
			diagnostics,
		};
	};
}

/**
 * The model type used by the session options.
 */
export type SessionModel = Model<any>;
