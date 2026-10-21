/**
 * What the client does with the extensions it loaded.
 *
 * The runtime turns the loaded extensions into the lookups the terminal UI needs: the message
 * renderers, the entry renderers, the tool renderers, the markdown transformers, the themes,
 * the shortcuts and the commands.
 *
 * The client never runs the event handlers or the tools of an extension. The commands and the
 * shortcuts of a client-side extension do run in the client, because they are UI interactions.
 */

import type {
	EntryRenderer,
	Extension,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionShortcut,
	ExtensionUIContext,
	MarkdownTransformer,
	MessageRenderer,
	RegisteredCommand,
	ToolRenderers,
} from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { KeybindingsConfig, KeyId } from "@earendil-works/pi-coding-agent/core/keybindings";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent/core/model-registry";
import type { ReadonlySessionManager } from "@earendil-works/pi-coding-agent/core/session-manager";
import {
	getAvailableThemesWithPaths,
	loadThemeFromPath,
	setRegisteredThemes,
	type Theme,
} from "@earendil-works/pi-coding-agent/core/theme/theme";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ClientExtensionInfo, ClientExtensionLoadResult } from "./client-extensions.ts";
import type { SessionFacade } from "./session-facade.ts";

/** An extension the server loaded, as the server reports it. */
export interface ClientExtensionServerInfo {
	/** Where the extension comes from. */
	readonly path: string;
	/** The side the extension declared. */
	readonly side: "client" | "server" | "both";
}

/** A command a client-side extension offers. */
export interface ClientExtensionCommand {
	/** The name of the command, without the leading slash. */
	readonly name: string;
	/** The name the command is invoked with. */
	readonly invocationName: string;
	/** What the command does. */
	readonly description?: string;
	/** The completions for the command arguments. */
	readonly getArgumentCompletions?: (
		argumentPrefix: string,
	) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
	/** The extension the command comes from. */
	readonly extensionPath: string;
	/** What the command does when the user runs it. */
	readonly handler: RegisteredCommand["handler"];
}

/**
 * The editor-global shortcuts an extension may not take over.
 *
 * The extension runtime of the coding agent keeps the same list. The client cannot ask it,
 * because the runtime lives in the server's process.
 */
const RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS = [
	"app.interrupt",
	"app.quit",
	"app.exit",
	"app.suspend",
	"app.thinking.cycle",
	"app.model.cycleForward",
	"app.model.cycleBackward",
	"app.model.select",
	"app.tools.expand",
	"app.thinking.toggle",
	"app.editor.external",
	"app.message.copy",
	"app.message.followUp",
	"tui.input.submit",
	"tui.select.confirm",
	"tui.select.cancel",
	"tui.input.copy",
	"tui.editor.deleteToLineEnd",
] as const;

type BuiltInKeyBindings = Partial<Record<KeyId, { keybinding: string; restrictOverride: boolean }>>;

function buildBuiltinKeybindings(resolvedKeybindings: KeybindingsConfig): BuiltInKeyBindings {
	const builtinKeybindings = {} as BuiltInKeyBindings;
	for (const [keybinding, keys] of Object.entries(resolvedKeybindings)) {
		if (keys === undefined) continue;
		const keyList = Array.isArray(keys) ? keys : [keys];
		const restrictOverride = (RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS as readonly string[]).includes(keybinding);
		for (const key of keyList) {
			const normalizedKey = key.toLowerCase() as KeyId;
			const existing = builtinKeybindings[normalizedKey];
			if (existing?.restrictOverride && !restrictOverride) continue;
			builtinKeybindings[normalizedKey] = { keybinding, restrictOverride };
		}
	}
	return builtinKeybindings;
}

/** The options of {@link createClientExtensionContext}. */
export interface ClientExtensionContextOptions {
	/** The UI the extension talks to. */
	readonly ui: ExtensionUIContext;
	/** The session the extension talks to. */
	readonly facade: SessionFacade;
	/** Called when the extension asks pi to shut down. */
	readonly shutdown?: () => void;
}

/**
 * The context a client-side extension gets.
 *
 * The agent runs in the server's process, so the context is a view of the session the client
 * already has: the model, the thinking level, the state of the agent and the actions the
 * client can perform.
 */
export function createClientExtensionContext(options: ClientExtensionContextOptions): ExtensionContext {
	const { facade, ui } = options;
	return {
		ui,
		mode: "tui",
		hasUI: true,
		cwd: facade.sessionManager.getCwd(),
		sessionManager: facade.sessionManager as unknown as ReadonlySessionManager,
		modelRegistry: facade.modelRuntime as unknown as ModelRegistry,
		model: facade.model,
		scopedModels: facade.scopedModels,
		thinkingLevel: facade.thinkingLevel,
		isIdle: () => facade.isIdle,
		isProjectTrusted: () => facade.settingsManager.isProjectTrusted(),
		signal: facade.agent.signal,
		abort: () => {
			void facade.abort();
		},
		hasPendingMessages: () => facade.pendingMessageCount > 0,
		shutdown: () => options.shutdown?.(),
		getContextUsage: () => facade.contextUsage,
		compact: (compactOptions) => {
			void facade.compact(compactOptions?.customInstructions);
		},
		getSystemPrompt: () => facade.systemPrompt,
	};
}

/**
 * The context a client-side command gets.
 *
 * It is the context of an extension plus the session actions the client can perform.
 */
export function createClientExtensionCommandContext(options: ClientExtensionContextOptions): ExtensionCommandContext {
	const base = createClientExtensionContext(options);
	const { facade } = options;
	return {
		...base,
		getSystemPromptOptions: () => ({}),
		waitForIdle: () => facade.waitForIdle(),
		newSession: async () => {
			const result = await facade.newSession();
			return { cancelled: result.cancelled };
		},
		fork: async (entryId: string) => {
			const result = await facade.fork(entryId);
			return { cancelled: result.cancelled };
		},
		navigateTree: async (
			targetId: string,
			navigateOptions?: {
				summarize?: boolean;
				customInstructions?: string;
				replaceInstructions?: boolean;
				label?: string;
			},
		) => {
			const result = await facade.navigateTree(targetId, navigateOptions);
			return { cancelled: result.cancelled };
		},
		switchSession: async (sessionPath: string) => {
			const result = await facade.switchSession(sessionPath);
			return { cancelled: result.cancelled };
		},
		reload: () => facade.reload(),
	} as unknown as ExtensionCommandContext;
}

/**
 * The extensions the client loaded, and what the terminal UI does with them.
 */
export class ClientExtensionRuntime {
	/** The extensions the client can use. */
	readonly extensions: Extension[];
	/** The extensions the client skipped because they declared the server side. */
	readonly skipped: ClientExtensionInfo[];
	/** The themes the extensions ship. */
	readonly themes: Theme[];
	/** The diagnostics of the load. */
	readonly diagnostics: ClientExtensionLoadResult["diagnostics"];

	constructor(load: ClientExtensionLoadResult) {
		this.extensions = load.extensions;
		this.skipped = load.skipped;
		this.themes = load.themes;
		this.diagnostics = load.diagnostics;
	}

	/** The renderer of a custom message. */
	getMessageRenderer(customType: string): MessageRenderer | undefined {
		for (const extension of this.extensions) {
			const renderer = extension.messageRenderers.get(customType);
			if (renderer) return renderer;
		}
		return undefined;
	}

	/** The renderer of a custom entry. */
	getEntryRenderer(customType: string): EntryRenderer | undefined {
		for (const extension of this.extensions) {
			const renderer = extension.entryRenderers?.get(customType);
			if (renderer) return renderer;
		}
		return undefined;
	}

	/** The transformers that run over the markdown of the transcript. */
	getMarkdownTransformers(): MarkdownTransformer[] {
		return this.extensions.flatMap((extension) =>
			extension.markdownTransformer ? [extension.markdownTransformer] : [],
		);
	}

	/**
	 * The renderers of a tool call.
	 *
	 * The extension resolvers run in load order, and the built-in renderers are the fallback.
	 */
	resolveToolRenderers(toolName: string, base: () => ToolRenderers | undefined): ToolRenderers | undefined {
		const resolvers = this.extensions.flatMap((extension) => extension.toolRenderers ?? []);
		const resolve = (index: number): ToolRenderers | undefined =>
			index < resolvers.length ? resolvers[index](toolName, () => resolve(index + 1)) : base();
		return resolve(0);
	}

	/**
	 * The shortcuts of the extensions.
	 *
	 * A shortcut that takes a reserved key is skipped, and a shortcut that another extension
	 * registered before wins.
	 */
	getShortcuts(resolvedKeybindings: KeybindingsConfig): Map<KeyId, ExtensionShortcut> {
		const builtinKeybindings = buildBuiltinKeybindings(resolvedKeybindings);
		const shortcuts = new Map<KeyId, ExtensionShortcut>();
		for (const extension of this.extensions) {
			for (const [key, shortcut] of extension.shortcuts) {
				const normalizedKey = key.toLowerCase() as KeyId;
				if (builtinKeybindings[normalizedKey]?.restrictOverride === true) continue;
				shortcuts.set(normalizedKey, shortcut);
			}
		}
		return shortcuts;
	}

	/**
	 * The commands the client runs.
	 *
	 * Only the commands of the extensions that declared the client side run here. A "both"
	 * extension runs its command on the server, where the agent lives.
	 */
	getCommands(): ClientExtensionCommand[] {
		const commands: ClientExtensionCommand[] = [];
		const counts = new Map<string, number>();
		for (const extension of this.extensions) {
			if (extension.side !== "client") continue;
			for (const command of extension.commands.values()) {
				counts.set(command.name, (counts.get(command.name) ?? 0) + 1);
			}
		}
		const seen = new Map<string, number>();
		for (const extension of this.extensions) {
			if (extension.side !== "client") continue;
			for (const command of extension.commands.values()) {
				const occurrence = (seen.get(command.name) ?? 0) + 1;
				seen.set(command.name, occurrence);
				const invocationName = (counts.get(command.name) ?? 0) > 1 ? `${command.name}:${occurrence}` : command.name;
				commands.push({
					name: command.name,
					invocationName,
					...(command.description !== undefined ? { description: command.description } : {}),
					...(command.getArgumentCompletions !== undefined
						? { getArgumentCompletions: command.getArgumentCompletions }
						: {}),
					extensionPath: extension.path,
					handler: command.handler,
				});
			}
		}
		return commands;
	}

	/**
	 * Register the themes of the extensions, so they can be picked in the theme selector.
	 *
	 * The themes that are already known stay known.
	 */
	registerThemes(): void {
		if (this.themes.length === 0) return;
		const existing: Theme[] = [];
		for (const info of getAvailableThemesWithPaths()) {
			if (!info.path) continue;
			try {
				existing.push(loadThemeFromPath(info.path));
			} catch {
				// A theme that cannot be read is reported by the resource loader.
			}
		}
		setRegisteredThemes([...existing, ...this.themes]);
	}

	/**
	 * The diagnostics of the client extensions.
	 *
	 * Besides the diagnostics of the load, it reports the extensions that declare the "both"
	 * side but that the server does not have: their server part does not work.
	 */
	getDiagnostics(
		serverExtensions?: ReadonlyArray<ClientExtensionServerInfo>,
	): ClientExtensionLoadResult["diagnostics"] {
		const diagnostics = [...this.diagnostics];
		for (const extension of this.extensions) {
			if (extension.side !== "both") continue;
			if (!serverExtensions) continue;
			if (serverExtensions.some((server) => sameExtension(server.path, extension.path))) continue;
			diagnostics.push({
				type: "warning",
				message: `Extension "${extension.path}" needs the server side too. Install it on the server, otherwise the parts that need the server do not work.`,
				path: extension.path,
			});
		}
		return diagnostics;
	}
}

/**
 * Whether two paths name the same extension.
 *
 * The client and the server can report the same extension with a relative or an absolute path.
 */
function sameExtension(clientPath: string, serverPath: string): boolean {
	if (clientPath === serverPath) return true;
	return clientPath.endsWith(serverPath) || serverPath.endsWith(clientPath);
}
