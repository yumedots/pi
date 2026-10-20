import * as piCodingAgent from "../../../../packages/coding-agent/src/core/extensions/types.ts";
import * as piAgentCore from "./pi-agent-core.ts";
import * as piAi from "./pi-ai.ts";
import * as piTui from "./pi-tui.ts";
import * as nodeChildProcess from "node:child_process";
import * as nodeOs from "node:os";
import * as nodePerfHooks from "node:perf_hooks";
import * as nodeUrl from "node:url";
import * as typebox from "typebox";
import * as typeboxCompile from "typebox/compile";
import * as typeboxValue from "typebox/value";

type Handler = (event: unknown, context: unknown) => unknown;

type TerminalInputHandler = (data: string) => boolean | void;

interface ToolDefinition {
	name: string;
	label?: string;
	description?: string;
	parameters?: unknown;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: undefined,
		onUpdate: undefined,
		context: unknown,
	) => Promise<unknown>;
}

interface ExtensionState {
	path: string;
	handlers: Map<string, Handler[]>;
	tools: Map<string, ToolDefinition>;
	commands: Map<string, unknown>;
	shortcuts: Map<string, unknown>;
	flags: Map<string, { default?: unknown }>;
	messageRenderers: Map<string, unknown>;
	entryRenderers: Map<string, unknown>;
	markdownTransformers: unknown[];
	toolRenderers: unknown[];
	autocompleteProviders: unknown[];
	terminalInputHandlers: TerminalInputHandler[];
}

interface HostGlobals {
	__piHostCall: (op: string, args: string) => string;
	__piNodeModules: Record<string, unknown>;
}

interface NodeModules {
	"node:path": {
		dirname: (value: string) => string;
		resolve: (...parts: string[]) => string;
	};
}

const globals = globalThis as unknown as HostGlobals;

const hostCall = (op: string, args: unknown): unknown => {
	const response = JSON.parse(globals.__piHostCall(op, JSON.stringify(args ?? {}))) as {
		ok: boolean;
		value?: unknown;
		error?: string;
	};
	if (!response.ok) throw new Error(response.error ?? "the host refused the call");
	return response.value;
};

const nodeModules = (): NodeModules => globals.__piNodeModules as unknown as NodeModules;

interface ThemeLike {
	fg(name: string, text: string): string;
	bg(name: string, text: string): string;
	bgStart(name: string): string;
	style(text: string, options: ThemeStyleOptions): string;
	bold(text: string): string;
	italic(text: string): string;
	underline(text: string): string;
	inverse(text: string): string;
	strikethrough(text: string): string;
	readonly colors: Record<string, unknown>;
	readonly name: string | undefined;
	readonly sourcePath: string | undefined;
	readonly appearance: string;
	getFgAnsi(name: string): string;
	getBgAnsi(name: string): string;
	getColorMode(): string;
	getThinkingBorderColor(level: string): (text: string) => string;
	getBashModeBorderColor(): (text: string) => string;
}

interface ComponentLike {
	render(width: number): string[];
	invalidate?(): void;
	dispose?(): void;
}

type ComponentFactory = (...args: unknown[]) => unknown;

interface ThemeTokens {
	fg: Record<string, string>;
	bg: Record<string, string>;
	colors: Record<string, unknown>;
	colorEnabled: boolean;
	name?: string;
	sourcePath?: string;
	appearance: string;
	colorMode: string;
}

interface ThemeStyleOptions {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	inverse?: boolean;
	strikethrough?: boolean;
}

let themeTokens: ThemeTokens | undefined;

const themeTokenMap = (): ThemeTokens => {
	if (!themeTokens) {
		try {
			const value = hostCall("theme.get", {}) as Partial<ThemeTokens> | undefined;
			themeTokens = {
				fg: value?.fg ?? {},
				bg: value?.bg ?? {},
				colors: value?.colors ?? {},
				colorEnabled: value?.colorEnabled ?? false,
				name: value?.name,
				sourcePath: value?.sourcePath,
				appearance: value?.appearance ?? "dark",
				colorMode: value?.colorMode ?? "truecolor",
			};
		} catch {
			themeTokens = {
				fg: {},
				bg: {},
				colors: {},
				colorEnabled: false,
				appearance: "dark",
				colorMode: "truecolor",
			};
		}
	}
	return themeTokens;
};

const styleText = (
	text: string,
	fgAnsi: string | undefined,
	bgAnsi: string | undefined,
	options: ThemeStyleOptions,
): string => {
	let prefix = "";
	let suffix = "";
	if (fgAnsi) {
		prefix += fgAnsi;
		suffix = "\x1b[39m";
	}
	if (bgAnsi) {
		prefix += bgAnsi;
		suffix = `\x1b[49m${suffix}`;
	}
	if (options.bold) prefix += "\x1b[1m";
	if (options.dim) prefix += "\x1b[2m";
	if (options.bold || options.dim) suffix = `\x1b[22m${suffix}`;
	if (options.italic) {
		prefix += "\x1b[3m";
		suffix = `\x1b[23m${suffix}`;
	}
	if (options.underline) {
		prefix += "\x1b[4m";
		suffix = `\x1b[24m${suffix}`;
	}
	if (options.inverse) {
		prefix += "\x1b[7m";
		suffix = `\x1b[27m${suffix}`;
	}
	if (options.strikethrough) {
		prefix += "\x1b[9m";
		suffix = `\x1b[29m${suffix}`;
	}
	return `${prefix}${text}${suffix}`;
};

const chalkStyle = (enabled: boolean, code: string, closing: string, text: string): string =>
	enabled ? `\x1b[${code}m${text}\x1b[${closing}m` : text;

const theme: ThemeLike = {
	fg: (name: string, text: string): string => {
		const prefix = themeTokenMap().fg[name];
		return prefix ? `${prefix}${text}\x1b[39m` : text;
	},
	bg: (name: string, text: string): string => {
		const prefix = themeTokenMap().bg[name];
		return prefix ? `${prefix}${text}\x1b[49m` : text;
	},
	bgStart: (name: string): string => themeTokenMap().bg[name] ?? "",
	style: (text: string, options: ThemeStyleOptions): string => {
		const tokens = themeTokenMap();
		const fgAnsi = options.fg === undefined ? undefined : tokens.fg[options.fg];
		const bgAnsi = options.bg === undefined ? undefined : tokens.bg[options.bg];
		return styleText(text, fgAnsi, bgAnsi, options);
	},
	bold: (text: string): string => chalkStyle(themeTokenMap().colorEnabled, "1", "22", text),
	italic: (text: string): string => chalkStyle(themeTokenMap().colorEnabled, "3", "23", text),
	underline: (text: string): string => chalkStyle(themeTokenMap().colorEnabled, "4", "24", text),
	inverse: (text: string): string => chalkStyle(themeTokenMap().colorEnabled, "7", "27", text),
	strikethrough: (text: string): string => chalkStyle(themeTokenMap().colorEnabled, "9", "29", text),
	get colors(): Record<string, unknown> {
		return themeTokenMap().colors;
	},
	get name(): string | undefined {
		return themeTokenMap().name;
	},
	get sourcePath(): string | undefined {
		return themeTokenMap().sourcePath;
	},
	get appearance(): string {
		return themeTokenMap().appearance;
	},
	getFgAnsi: (name: string): string => themeTokenMap().fg[name] ?? "",
	getBgAnsi: (name: string): string => themeTokenMap().bg[name] ?? "",
	getColorMode: (): string => themeTokenMap().colorMode,
	getThinkingBorderColor: (level: string) => (text: string): string =>
		theme.fg(`thinking${level}`, text),
	getBashModeBorderColor: () => (text: string): string => theme.fg("bashMode", text),
};

let hostModeValue: string | undefined;

const hostMode = (): string => {
	if (!hostModeValue) {
		try {
			hostModeValue = hostCall("context.mode", {}) as string;
		} catch {
			hostModeValue = "print";
		}
	}
	return hostModeValue;
};

const tuiStub = (): unknown =>
	new Proxy(
		{},
		{
			get: (_target, property) => {
				if (typeof property === "symbol" || property === "then") return undefined;
				if (property === "requestRender") return () => undefined;
				if (property === "theme") return theme;
				return () => undefined;
			},
		},
	);

const footerDataStub = () => ({
	getGitBranch: () => {
		try {
			return hostCall("footer.getGitBranch", {}) as string | undefined;
		} catch {
			return undefined;
		}
	},
	getExtensionStatuses: () => {
		try {
			return hostCall("footer.getExtensionStatuses", {}) as Record<string, string>;
		} catch {
			return {};
		}
	},
	getAvailableProviderCount: () => 0,
	onBranchChange: () => () => undefined,
});

const componentRegistry = new Map<string, { factory: ComponentFactory; component?: ComponentLike }>();
let componentCounter = 0;
let toolCallCounter = 0;

const registerTerminalInput = (
	state: ExtensionState,
	handler: TerminalInputHandler,
): (() => void) => {
	state.terminalInputHandlers.push(handler);
	return () => {
		const index = state.terminalInputHandlers.indexOf(handler);
		if (index >= 0) state.terminalInputHandlers.splice(index, 1);
	};
};

const createModelRegistry = () => ({
	refresh: () => hostCall("models.refresh", {}),
	getError: () => hostCall("models.getError", {}),
	getAll: () => hostCall("models.list", {}),
	getAvailable: () => hostCall("models.listAvailable", {}),
	find: (provider: string, modelId: string) => hostCall("models.find", { provider, modelId }),
	hasConfiguredAuth: (model: unknown) => hostCall("models.hasConfiguredAuth", { model }),
	getProviderAuthStatus: (provider: string) => hostCall("models.getProviderAuthStatus", { provider }),
	getProvider: (provider: string) => hostCall("models.getProvider", { provider }),
	getProviderDisplayName: (provider: string) =>
		hostCall("models.getProviderDisplayName", { provider }),
	isUsingOAuth: (model: unknown) => hostCall("models.isUsingOAuth", { model }),
	registerProvider: (provider: unknown, config?: unknown) => {
		hostCall("provider.register", { provider, config });
	},
	unregisterProvider: (name: string) => {
		hostCall("provider.unregister", { name });
	},
	registerVirtualModel: (definition: unknown) => {
		hostCall("model.registerVirtual", { model: definition });
	},
	unregisterVirtualModel: (provider: string, id: string) => {
		hostCall("model.unregisterVirtual", { provider, id });
	},
	getRegisteredProviderIds: () => hostCall("models.getRegisteredProviderIds", {}),
});

const registerComponent = (factory: ComponentFactory): string => {
	const id = `component-${++componentCounter}`;
	componentRegistry.set(id, { factory });
	return id;
};

const renderComponent = (id: string, width: number): string[] => {
	const entry = componentRegistry.get(id);
	if (!entry) return [];
	if (!entry.component) {
		const produced = entry.factory(tuiStub(), theme, footerDataStub());
		if (!produced || typeof (produced as ComponentLike).render !== "function") return [];
		entry.component = produced as ComponentLike;
	}
	const lines = entry.component.render(width);
	return Array.isArray(lines) ? lines.map((line) => String(line)) : [];
};

const VIRTUAL_MODULES: Record<string, unknown> = {
	typebox,
	"typebox/compile": typeboxCompile,
	"typebox/value": typeboxValue,
	"@sinclair/typebox": typebox,
	"@sinclair/typebox/compile": typeboxCompile,
	"@sinclair/typebox/value": typeboxValue,
	"@earendil-works/pi-agent-core": piAgentCore,
	"@mariozechner/pi-agent-core": piAgentCore,
	"@earendil-works/pi-tui": piTui,
	"@mariozechner/pi-tui": piTui,
	"@earendil-works/pi-ai": piAi,
	"@earendil-works/pi-ai/compat": piAi,
	"@earendil-works/pi-ai/oauth": piAi,
	"@earendil-works/pi-ai/providers/all": piAi,
	"@mariozechner/pi-ai": piAi,
	"@mariozechner/pi-ai/compat": piAi,
	"@mariozechner/pi-ai/oauth": piAi,
	"@mariozechner/pi-ai/providers/all": piAi,
	"@earendil-works/pi-coding-agent": piCodingAgent,
	"@mariozechner/pi-coding-agent": piCodingAgent,
};

const moduleCache = new Map<string, { exports: Record<string, unknown> }>();

/// The node builtins an extension may import.
///
/// The runtime supplies the file system and the path; the rest are the
/// shims, bundled with the extension host. An extension that imports a
/// builtin that is not here fails to load at all, so the list is the
/// contract.
const NODE_BUILTINS: Record<string, unknown> = {
	"node:child_process": nodeChildProcess,
	"node:os": nodeOs,
	"node:perf_hooks": nodePerfHooks,
	"node:url": nodeUrl,
	child_process: nodeChildProcess,
	os: nodeOs,
	perf_hooks: nodePerfHooks,
	url: nodeUrl,
};

const resolveModule = (specifier: string, referrer: string): Record<string, unknown> => {
	if (Object.prototype.hasOwnProperty.call(VIRTUAL_MODULES, specifier)) {
		return VIRTUAL_MODULES[specifier] as Record<string, unknown>;
	}
	if (Object.prototype.hasOwnProperty.call(NODE_BUILTINS, specifier)) {
		return NODE_BUILTINS[specifier] as Record<string, unknown>;
	}
	const builtins = globals.__piNodeModules;
	if (Object.prototype.hasOwnProperty.call(builtins, specifier)) {
		return builtins[specifier] as Record<string, unknown>;
	}
	if (specifier.startsWith(".") || specifier.startsWith("/")) {
		const paths = nodeModules()["node:path"];
		const absolute = specifier.startsWith("/")
			? specifier
			: paths.resolve(paths.dirname(referrer), specifier);
		const loaded = hostCall("module.load", { path: absolute }) as {
			path: string;
			code: string;
		};
		return loadModule(loaded.path, loaded.code);
	}
	// A subpath of one of pi's own packages that the host does not publish is
	// a gap on this side, not a mistake in the extension: resolving it to an
	// empty module lets the extension load, and only the names it wanted are
	// missing. Anything else is a genuine mistake and stays an error.
	if (specifier.startsWith("@earendil-works/") || specifier.startsWith("@mariozechner/")) {
		return {};
	}
	throw new Error(`cannot resolve "${specifier}" from "${referrer}"`);
};

const loadModule = (path: string, code: string): Record<string, unknown> => {
	const cached = moduleCache.get(path);
	if (cached) return cached.exports;
	const module = { exports: {} as Record<string, unknown> };
	moduleCache.set(path, module);
	const paths = nodeModules()["node:path"];
	const factory = new Function(
		"exports",
		"require",
		"module",
		"__filename",
		"__dirname",
		"__piExports",
		code,
	);
	factory(
		module.exports,
		(specifier: string) => resolveModule(specifier, path),
		module,
		path,
		paths.dirname(path),
		module.exports,
	);
	return module.exports;
};

const createEventBus = () => {
	const handlers = new Map<string, Handler[]>();
	return {
		emit: (channel: string, data: unknown) => {
			for (const handler of handlers.get(channel) ?? []) {
				try {
					void handler(data, undefined);
				} catch (error) {
					console.error(`Event handler error (${channel}):`, error);
				}
			}
		},
		on: (channel: string, handler: Handler) => {
			const list = handlers.get(channel) ?? [];
			list.push(handler);
			handlers.set(channel, list);
			return () => {
				const current = handlers.get(channel) ?? [];
				const index = current.indexOf(handler);
				if (index >= 0) current.splice(index, 1);
			};
		},
	};
};

const createContext = (state: ExtensionState) => ({
	ui: {
		theme,
		notify: (message: string, type?: string) =>
			{ hostCall("ui.notify", { message, type: type ?? "info" }); },
		setStatus: (key: string, text?: string) => { hostCall("ui.setStatus", { key, text: text ?? "" }); },
		setWidget: (key: string, content?: unknown, options?: { placement?: string }) => {
			if (content === undefined) {
				hostCall("ui.setWidget", { key });
				return;
			}
			const placement = options?.placement ?? "aboveEditor";
			if (Array.isArray(content)) {
				hostCall("ui.setWidget", { key, lines: content, placement });
				return;
			}
			hostCall("ui.setWidget", { key, component: registerComponent(content as ComponentFactory), placement });
		},
		setHeader: (factory?: ComponentFactory) => {
			if (!factory) {
				hostCall("ui.setHeader", {});
				return;
			}
			hostCall("ui.setHeader", { component: registerComponent(factory) });
		},
		setFooter: (factory?: ComponentFactory) => {
			if (!factory) {
				hostCall("ui.setFooter", {});
				return;
			}
			hostCall("ui.setFooter", { component: registerComponent(factory) });
		},
		setTitle: (title: string) => { hostCall("ui.setTitle", { title }); },
		setWorkingMessage: (message?: string) => { hostCall("ui.setWorkingMessage", { message: message ?? "" }); },
		setWorkingVisible: (visible: boolean) => { hostCall("ui.setWorkingVisible", { visible }); },
		setHiddenThinkingLabel: (label: string) => { hostCall("ui.setHiddenThinkingLabel", { label }); },
		setEditorText: (text: string) => { hostCall("ui.setEditorText", { text }); },
		getEditorText: () => hostCall("ui.getEditorText", {}),
		pasteToEditor: (text: string) => { hostCall("ui.pasteToEditor", { text }); },
		select: (title: string, options: string[]) => hostCall("ui.select", { title, options }),
		confirm: (title: string, message: string) => hostCall("ui.confirm", { title, message }),
		input: (title: string, placeholder?: string) => hostCall("ui.input", { title, placeholder }),
		editor: (title: string, prefill?: string) => hostCall("ui.editor", { title, prefill }),
		custom: (factory: ComponentFactory) =>
			hostCall("ui.custom", { component: registerComponent(factory) }),
		setWorkingIndicator: (options?: unknown) =>
			hostCall("ui.setWorkingIndicator", { options: options ?? null }),
		setEditorComponent: (factory?: ComponentFactory) =>
			hostCall("ui.setEditorComponent", {
				component: factory ? registerComponent(factory) : null,
			}),
		getEditorComponent: () => hostCall("ui.getEditorComponent", {}),
		getAllThemes: () => hostCall("ui.getAllThemes", {}),
		getTheme: (name: string) => hostCall("ui.getTheme", { name }),
		setTheme: (theme: unknown) => hostCall("ui.setTheme", { theme }),
		getToolsExpanded: () => hostCall("ui.getToolsExpanded", {}),
		setToolsExpanded: (expanded: boolean) => { hostCall("ui.setToolsExpanded", { expanded }); },
		onTerminalInput: (handler: TerminalInputHandler) => registerTerminalInput(state, handler),
		addAutocompleteProvider: (factory: unknown) => {
			state.autocompleteProviders.push(factory);
		},
	},
	get mode() {
		return hostMode();
	},
	get hasUI() {
		return hostMode() === "tui";
	},
	get cwd() {
		return hostCall("process.cwd", {});
	},
	sessionManager: {
		getCwd: () => hostCall("process.cwd", {}),
		getSessionDir: () => hostCall("session.getDir", {}),
		getSessionId: () => hostCall("session.getId", {}),
		getSessionFile: () => hostCall("session.getFile", {}),
		getLeafId: () => hostCall("session.getLeafId", {}),
		getLeafEntry: () => hostCall("session.getLeafEntry", {}),
		getEntry: (id: string) => hostCall("session.getEntry", { id }),
		getLabel: (id: string) => hostCall("session.getLabel", { id }),
		getBranch: () => hostCall("session.getBranch", {}),
		buildContextEntries: () => hostCall("session.buildContextEntries", {}),
		buildSessionProjection: () => hostCall("session.buildSessionProjection", {}),
		getHeader: () => hostCall("session.getHeader", {}),
		getEntries: () => hostCall("session.getEntries", {}),
		getTree: () => hostCall("session.getTree", {}),
		getSessionName: () => {
		const answer = hostCall("session.getSessionName", {}) as string | null;
		return answer ?? undefined;
	},
	},
	modelRegistry: createModelRegistry(),
	get model() {
		return hostCall("model.get", {});
	},
	scopedModels: [],
	get thinkingLevel(): string {
		const answer = hostCall("model.getThinkingLevel", {}) as { level?: string };
		return answer?.level ?? "off";
	},
	isIdle: () => hostCall("agent.isIdle", {}),
	isProjectTrusted: () => hostCall("agent.isProjectTrusted", {}),
	signal: undefined,
	abort: () => hostCall("agent.abort", {}),
	hasPendingMessages: () => hostCall("agent.hasPendingMessages", {}),
	shutdown: () => hostCall("session.shutdown", {}),
	getContextUsage: () => hostCall("agent.getContextUsage", {}),
	compact: (options?: unknown) => hostCall("agent.compact", { options }),
	getSystemPrompt: () => {
		const answer = hostCall("agent.getSystemPrompt", {}) as { prompt?: string };
		return answer?.prompt ?? "";
	},
	extensionPath: state.path,
});

const createCommandContext = (state: ExtensionState) => ({
	...createContext(state),
	getSystemPromptOptions: () => hostCall("session.getSystemPromptOptions", {}),
	waitForIdle: () => hostCall("session.waitForIdle", {}),
	newSession: (options?: unknown) => hostCall("session.newSession", { options: options ?? null }),
	fork: (entryId: string, options?: unknown) =>
		hostCall("session.fork", { entryId, options: options ?? null }),
	navigateTree: (targetId: string, options?: unknown) =>
		hostCall("session.navigateTree", { targetId, options: options ?? null }),
	switchSession: (sessionPath: string, options?: unknown) =>
		hostCall("session.switchSession", { sessionPath, options: options ?? null }),
	reload: () => hostCall("session.reload", {}),
});

const createToolContext = (state: ExtensionState) => ({
	...createContext(state),
	tools: {
		registered: hostCall("tools.getAll", {}),
		getExposure: (name: string) => hostCall("tools.getExposure", { name }),
		getNamespace: (name: string) => hostCall("tools.getNamespace", { name }),
		getPromptGuidelines: (name: string) => hostCall("tools.getPromptGuidelines", { name }),
	},
	executeTool: (name: string, args: unknown, options?: unknown) =>
		hostCall("tools.execute", { name, args, options: options ?? null }),
});

const eventBus = createEventBus();

const createApi = (state: ExtensionState) => {
	const events = eventBus;
	return {
		on: (event: string, handler: Handler) => {
			const handlers = state.handlers.get(event) ?? [];
			handlers.push(handler);
			state.handlers.set(event, handlers);
			return () => {
				const current = state.handlers.get(event) ?? [];
				const index = current.indexOf(handler);
				if (index >= 0) current.splice(index, 1);
			};
		},
		registerTool: (tool: ToolDefinition) => {
			state.tools.set(tool.name, tool);
		},
		registerCommand: (name: string, options: unknown) => {
			state.commands.set(name, options);
		},
		registerShortcut: (shortcut: string, options: unknown) => {
			state.shortcuts.set(shortcut, options);
		},
		registerFlag: (name: string, options: { default?: unknown }) => {
			state.flags.set(name, options);
		},
		getFlag: (name: string) => state.flags.get(name)?.default,
		registerMessageRenderer: (customType: string, renderer: unknown) => {
			state.messageRenderers.set(customType, renderer);
		},
		registerMarkdownTransformer: (transformer: unknown) => {
			state.markdownTransformers.push(transformer);
		},
		registerEntryRenderer: (customType: string, renderer: unknown) => {
			state.entryRenderers.set(customType, renderer);
		},
		registerToolRenderer: (resolver: unknown) => {
			state.toolRenderers.push(resolver);
		},
		sendMessage: (message: unknown, options?: unknown) => {
			hostCall("session.sendMessage", { message, options });
		},
		sendUserMessage: (content: unknown, options?: unknown) => {
			hostCall("session.sendUserMessage", { content, options });
		},
		appendEntry: (customType: string, data?: unknown) => {
			hostCall("session.appendEntry", { customType, data });
		},
		setSessionName: (name: string) => {
			hostCall("session.setSessionName", { name });
		},
		getSessionName: () => {
		const answer = hostCall("session.getSessionName", {}) as string | null;
		return answer ?? undefined;
	},
		setLabel: (entryId: string, label?: string) => {
			hostCall("session.setLabel", { entryId, label });
		},
		exec: (command: string, args: string[], options?: unknown) =>
			hostCall("session.exec", { command, args, options }),
		getActiveTools: () => {
		const answer = hostCall("tools.getActive", {}) as { tools?: string[] };
		return answer?.tools ?? [];
	},
		getAllTools: () => hostCall("tools.getAll", {}),
		getSettings: () => hostCall("settings.get", {}),
		setActiveTools: (toolNames: string[]) => {
			hostCall("tools.setActive", { toolNames });
		},
		getCommands: () => hostCall("commands.get", {}),
		setModel: (model: unknown) => hostCall("model.set", { model }),
		getThinkingLevel: () => {
		const answer = hostCall("model.getThinkingLevel", {}) as { level?: string };
		return answer?.level ?? "off";
	},
		setThinkingLevel: (level: unknown) => {
			hostCall("model.setThinkingLevel", { level });
		},
		registerProvider: (provider: unknown, config?: unknown) => {
			hostCall("provider.register", { provider, config });
		},
		unregisterProvider: (name: string) => {
			hostCall("provider.unregister", { name });
		},
		registerMcpServer: (name: string, config: unknown) => {
			hostCall("mcp.register", { name, config });
		},
		unregisterMcpServer: (name: string) => {
			hostCall("mcp.unregister", { name });
		},
		getMcpServers: () => hostCall("mcp.list", {}),
		registerVirtualModel: (model: unknown) => {
			hostCall("model.registerVirtual", { model });
		},
		unregisterVirtualModel: (provider: string, id: string) => {
			hostCall("model.unregisterVirtual", { provider, id });
		},
		events,
	};
};

const extensions: ExtensionState[] = [];

const listTools = () =>
	extensions.flatMap((state) =>
		[...state.tools.values()].map((tool) => ({
			name: tool.name,
			label: tool.label ?? tool.name,
			description: tool.description ?? "",
			parameters: tool.parameters ?? null,
		})),
	);

const loadExtension = async (path: string, code: string) => {
	const exports = loadModule(path, code);
	const factory = exports.default ?? exports;
	if (typeof factory !== "function") {
		throw new Error(`${path} does not export an extension factory`);
	}
	const state: ExtensionState = {
		path,
		handlers: new Map(),
		tools: new Map(),
		commands: new Map(),
		shortcuts: new Map(),
		flags: new Map(),
		messageRenderers: new Map(),
		entryRenderers: new Map(),
		markdownTransformers: [],
		toolRenderers: [],
		autocompleteProviders: [],
		terminalInputHandlers: [],
	};
	// The factory may be async: the original awaits it before it commits the
	// registrations, so an extension that registers after an `await` is
	// registered by the time the load returns.
	await (factory as (api: unknown) => unknown)(createApi(state));
	extensions.push(state);
	return { path, tools: listTools() };
};

const callTool = async (name: string, args: unknown) => {
	let found: { state: ExtensionState; tool: ToolDefinition } | undefined;
	for (const state of extensions) {
		const tool = state.tools.get(name);
		if (tool) {
			found = { state, tool };
			break;
		}
	}
	if (!found) throw new Error(`unknown tool: ${name}`);
	const result = await found.tool.execute(
		`tool-call-${++toolCallCounter}`,
		args,
		undefined,
		undefined,
		createToolContext(found.state),
	);
	return result ?? null;
};

const listCommands = () =>
	extensions.flatMap((state) =>
		[...state.commands.entries()].map(([name, options]) => {
			const description =
				options && typeof options === "object" && "description" in options
					? String(options.description ?? "")
					: "";
			return { name, description, path: state.path };
		}),
	);

const listHandlers = () =>
	extensions.flatMap((state) =>
		[...state.handlers.keys()].map((event) => ({ event, path: state.path })),
	);

const dispatch = async (event: string, payload: unknown) => {
	let result: unknown;
	for (const state of extensions) {
		const context = createContext(state);
		for (const handler of state.handlers.get(event) ?? []) {
			const value = await handler(payload, context);
			if (value !== undefined && result === undefined) result = value;
		}
	}
	return result === undefined ? null : result;
};

const emitInput = async (text: string, images: unknown, source: string) => {
	let currentText = text;
	let currentImages = images;
	for (const state of extensions) {
		const context = createContext(state);
		for (const handler of state.handlers.get("input") ?? []) {
			const result = (await handler(
				{ type: "input", text: currentText, images: currentImages, source },
				context,
			)) as { action?: string; text?: string; images?: unknown } | undefined;
			if (result?.action === "handled") return { action: "handled" };
			if (result?.action === "transform" && typeof result.text === "string") {
				currentText = result.text;
				currentImages = result.images ?? currentImages;
			}
		}
	}
	return currentText === text
		? { action: "continue" }
		: { action: "transform", text: currentText };
};

const runCommand = async (name: string, args: string) => {
	for (const state of extensions) {
		const options = state.commands.get(name);
		if (!options || typeof options !== "object" || !("handler" in options)) continue;
		const handler = options.handler;
		if (typeof handler !== "function") continue;
		const result = await handler(args, createContext(state));
		return result === undefined ? null : result;
	}
	throw new Error(`unknown command: ${name}`);
};

(globalThis as unknown as Record<string, unknown>).__piExtensionHost = {
	loadExtension,
	callTool,
	listTools,
	listCommands,
	listHandlers,
	runCommand,
	renderComponent,
	emitInput,
	dispatch,
};
