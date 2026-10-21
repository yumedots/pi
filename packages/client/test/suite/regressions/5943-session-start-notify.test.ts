import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { Container, Text } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../../../../coding-agent/src/core/agent-session.ts";
import { initTheme } from "../../../../coding-agent/src/core/theme/theme.ts";
import { createHarness, createTestUiContext } from "../../../../coding-agent/test/suite/harness.ts";
import { InteractiveMode } from "../../../src/interactive-mode.ts";

type LoadedResourcesResult<T> = { [K in keyof T]: T[K] } & {
	diagnostics: Array<{ type: "warning" | "error" | "collision"; message: string }>;
};

type LoadedResourcesContext = {
	resourceDiagnosticsContainer: Container;
	chatContainer: Container;
	facade: {
		promptTemplates: [];
		resourceLoader: {
			getSkills: () => LoadedResourcesResult<{ skills: [] }>;
			getPrompts: () => LoadedResourcesResult<{ prompts: [] }>;
			getThemes: () => LoadedResourcesResult<{ themes: [] }>;
			getExtensions: () => { extensions: []; errors: [] };
		};
		extensionRunner: {
			getCommandDiagnostics: () => [];
			getShortcutDiagnostics: () => [];
			getRegisteredCommands: () => [];
		};
	};
	formatDiagnostics: () => string;
	getBuiltInCommandConflictDiagnostics: (extensionRunner: LoadedResourcesContext["facade"]["extensionRunner"]) => [];
	getClientExtensionDiagnostics: () => [];
};
type RebindContext = {
	unsubscribe?: () => void;
	sessionManager: { getSessionId: () => string };
	refreshSessionList: () => Promise<void>;
	facade: { sessionManager: { getSessionId: () => string } };
	applyRuntimeSettings: () => void;
	programStatus: { reset(): void };
	renderCurrentSessionState: () => void;
	bindCurrentSessionExtensions: () => Promise<void>;
	subscribeToAgent: () => void;
	updateAvailableProviderCount: () => Promise<void>;
	updateEditorBorderColor: () => void;
	updateTerminalTitle: () => void;
	syncEmptySessionScreen: () => void;
};

type ReloadCommandContext = {
	hideThinkingBlock: boolean;
	settingsManager: {
		getHttpIdleTimeoutMs: () => number;
		getHideThinkingBlock: () => boolean;
		getOutputPad: () => 0 | 1;
		getEditorPaddingX: () => number;
		getAutocompleteMaxVisible: () => number;
		getShowHardwareCursor: () => boolean;
		getClearOnShrink: () => boolean;
	};
	facade: {
		isStreaming: boolean;
		isCompacting: boolean;
		reload: () => Promise<void>;
		sessionManager: { getSessionId: () => string };
		settingsManager: {
			getHttpIdleTimeoutMs: () => number;
			getHideThinkingBlock: () => boolean;
			getOutputPad: () => 0 | 1;
			getEditorPaddingX: () => number;
			getAutocompleteMaxVisible: () => number;
			getShowHardwareCursor: () => boolean;
			getClearOnShrink: () => boolean;
		};
		modelRuntime: { getError: () => string | undefined };
	};
	keybindings: { reload: () => void };
	customHeader?: unknown;
	builtInHeader?: unknown;
	editorContainer: { clear: () => void; addChild: (component: unknown) => void };
	ui: {
		setFocus: (component: unknown) => void;
		requestRender: (force?: boolean) => void;
		setShowHardwareCursor: (enabled: boolean) => void;
		setClearOnShrink: (enabled: boolean) => void;
	};
	editor: unknown;
	defaultEditor: { setPaddingX: (padding: number) => void; setAutocompleteMaxVisible: (maxVisible: number) => void };
	themeController: { applyFromSettings: () => Promise<void> };
	resetExtensionUI: () => void;
	rebuildChatFromMessages: () => void;
	setupAutocompleteProvider: () => void;
	setupExtensionShortcuts: (runner: unknown) => void;
	showResourceDiagnostics: () => void;
	maybeSaveImplicitProjectTrustAfterReload: () => boolean;
	showStatus: (message: string) => void;
	showWarning: (message: string) => void;
	showError: (message: string) => void;
};

type InteractiveModePrototype = {
	showResourceDiagnostics(this: LoadedResourcesContext): void;
	rebindCurrentSession(this: RebindContext, options?: { renderBeforeBind?: boolean }): Promise<void>;
	handleReloadCommand(this: ReloadCommandContext): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

type ReloadCommandContextOverrides = Omit<
	Partial<ReloadCommandContext>,
	"facade" | "keybindings" | "editorContainer" | "ui" | "defaultEditor" | "themeController"
> & {
	facade?: Omit<Partial<ReloadCommandContext["facade"]>, "settingsManager"> & {
		settingsManager?: Partial<ReloadCommandContext["facade"]["settingsManager"]>;
	};
	keybindings?: Partial<ReloadCommandContext["keybindings"]>;
	editorContainer?: Partial<ReloadCommandContext["editorContainer"]>;
	ui?: Partial<ReloadCommandContext["ui"]>;
	defaultEditor?: Partial<ReloadCommandContext["defaultEditor"]>;
	themeController?: Partial<ReloadCommandContext["themeController"]>;
};

function createReloadCommandContext(overrides: ReloadCommandContextOverrides = {}): ReloadCommandContext {
	const editor = overrides.editor ?? {};
	const settingsManager = {
		getHttpIdleTimeoutMs: () => 0,
		getHideThinkingBlock: () => false,
		getOutputPad: () => 1 as 0 | 1,
		getEditorPaddingX: () => 1,
		getAutocompleteMaxVisible: () => 10,
		getShowHardwareCursor: () => false,
		getClearOnShrink: () => false,
		...overrides.facade?.settingsManager,
	};
	return {
		hideThinkingBlock: overrides.hideThinkingBlock ?? false,
		settingsManager,
		facade: {
			isStreaming: overrides.facade?.isStreaming ?? false,
			isCompacting: overrides.facade?.isCompacting ?? false,
			reload: overrides.facade?.reload ?? (async () => {}),
			settingsManager,
			modelRuntime: overrides.facade?.modelRuntime ?? { getError: () => undefined },
			sessionManager: overrides.facade?.sessionManager ?? { getSessionId: () => "test-session" },
		},
		keybindings: { reload: () => {}, ...overrides.keybindings },
		editorContainer: { clear: () => {}, addChild: () => {}, ...overrides.editorContainer },
		ui: {
			setFocus: () => {},
			requestRender: () => {},
			setShowHardwareCursor: () => {},
			setClearOnShrink: () => {},
			...overrides.ui,
		},
		editor,
		defaultEditor: { setPaddingX: () => {}, setAutocompleteMaxVisible: () => {}, ...overrides.defaultEditor },
		themeController: { applyFromSettings: async () => {}, ...overrides.themeController },
		customHeader: overrides.customHeader,
		builtInHeader: overrides.builtInHeader,
		resetExtensionUI: overrides.resetExtensionUI ?? (() => {}),
		rebuildChatFromMessages: overrides.rebuildChatFromMessages ?? (() => {}),
		setupAutocompleteProvider: overrides.setupAutocompleteProvider ?? (() => {}),
		setupExtensionShortcuts: overrides.setupExtensionShortcuts ?? (() => {}),
		showResourceDiagnostics: overrides.showResourceDiagnostics ?? (() => {}),
		maybeSaveImplicitProjectTrustAfterReload: overrides.maybeSaveImplicitProjectTrustAfterReload ?? (() => false),
		showStatus: overrides.showStatus ?? (() => {}),
		showWarning: overrides.showWarning ?? (() => {}),
		showError: overrides.showError ?? (() => {}),
	};
}

type MessageEvent = Extract<AgentSessionEvent, { type: "message_start" | "message_end" }>;

function getMessageText(event: MessageEvent): string {
	const message = event.message;
	if (!("content" in message)) {
		return "";
	}
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function createLoadedResourcesContext(): LoadedResourcesContext {
	return {
		resourceDiagnosticsContainer: new Container(),
		chatContainer: new Container(),
		facade: {
			promptTemplates: [],
			resourceLoader: {
				getSkills: () => ({ skills: [], diagnostics: [{ type: "warning" as const, message: "duplicate skill" }] }),
				getPrompts: () => ({ prompts: [], diagnostics: [] }),
				getThemes: () => ({ themes: [], diagnostics: [] }),
				getExtensions: () => ({ extensions: [], errors: [] }),
			},
			extensionRunner: {
				getCommandDiagnostics: () => [],
				getShortcutDiagnostics: () => [],
				getRegisteredCommands: () => [],
			},
		},
		formatDiagnostics: () => "diagnostics",
		getBuiltInCommandConflictDiagnostics: () => [],
		getClientExtensionDiagnostics: () => [],
	};
}

describe("regression #5943: session_start transient UI", () => {
	it("renders resource diagnostics before restored messages without stale entries", () => {
		initTheme("dark", false);
		const context = createLoadedResourcesContext();
		const root = new Container();
		root.addChild(context.resourceDiagnosticsContainer);
		root.addChild(context.chatContainer);
		context.resourceDiagnosticsContainer.addChild(new Text("stale resources", 0, 0));
		context.chatContainer.addChild(new Text("restored message", 0, 0));

		interactiveModePrototype.showResourceDiagnostics.call(context);

		const chatRendered = context.chatContainer.render(80).join("\n");
		expect(chatRendered).toContain("restored message");
		expect(chatRendered).not.toContain("[Skill conflicts]");

		const rendered = root.render(80).join("\n");
		expect(rendered).not.toContain("stale resources");
		expect(rendered).toContain("[Skill conflicts]");
		expect(rendered.indexOf("[Skill conflicts]")).toBeLessThan(rendered.indexOf("restored message"));
	});

	it("renders replacement session state before session_start handlers can notify", async () => {
		const events: string[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_start", (_event, ctx) => {
						ctx.ui.notify("Hello Error", "error");
					});
				},
			],
		});

		try {
			const context: RebindContext = {
				sessionManager: { getSessionId: () => "test-session" },
				refreshSessionList: async () => {},
				facade: { sessionManager: { getSessionId: () => "test-session" } },
				applyRuntimeSettings: () => events.push("apply"),
				programStatus: { reset: () => {} },
				renderCurrentSessionState: () => events.push("render"),
				bindCurrentSessionExtensions: async () => {
					events.push("bind");
					await harness.session.bindExtensions({
						uiContext: createTestUiContext({ notify: (message) => events.push(`notify:${message}`) }),
						mode: "tui",
					});
				},
				subscribeToAgent: () => events.push("subscribe"),
				updateAvailableProviderCount: async () => {},
				updateEditorBorderColor: () => {},
				updateTerminalTitle: () => {},
				syncEmptySessionScreen: () => {},
			};

			await interactiveModePrototype.rebindCurrentSession.call(context, { renderBeforeBind: true });

			expect(events).toEqual(["apply", "render", "subscribe", "bind", "notify:Hello Error"]);
		} finally {
			harness.cleanup();
		}
	});

	it("subscribes before replacement session_start handlers send messages", async () => {
		const events: string[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_start", () => {
						pi.sendMessage({
							customType: "session-start",
							content: "custom from start",
							display: true,
						});
					});
				},
			],
		});

		try {
			const context: RebindContext = {
				sessionManager: { getSessionId: () => "test-session" },
				refreshSessionList: async () => {},
				facade: { sessionManager: { getSessionId: () => "test-session" } },
				applyRuntimeSettings: () => {},
				programStatus: { reset: () => {} },
				renderCurrentSessionState: () => events.push("render"),
				bindCurrentSessionExtensions: async () => {
					events.push("bind");
					await harness.session.bindExtensions({
						uiContext: createTestUiContext(),
						mode: "tui",
					});
				},
				subscribeToAgent: () => {
					events.push("subscribe");
					harness.session.subscribe((event) => {
						if (event.type !== "message_start" && event.type !== "message_end") {
							return;
						}
						events.push(`${event.type}:${event.message.role}:${getMessageText(event)}`);
					});
				},
				updateAvailableProviderCount: async () => {},
				updateEditorBorderColor: () => {},
				updateTerminalTitle: () => {},
				syncEmptySessionScreen: () => {},
			};

			await interactiveModePrototype.rebindCurrentSession.call(context, { renderBeforeBind: true });

			expect(events).toEqual([
				"render",
				"subscribe",
				"bind",
				"message_start:custom:custom from start",
				"message_end:custom:custom from start",
			]);
		} finally {
			harness.cleanup();
		}
	});

	it("subscribes before replacement session_start handlers send user messages", async () => {
		const events: string[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_start", () => {
						pi.sendUserMessage("user from start");
					});
				},
			],
		});
		harness.setResponses([fauxAssistantMessage("assistant from start")]);

		try {
			const context: RebindContext = {
				sessionManager: { getSessionId: () => "test-session" },
				refreshSessionList: async () => {},
				facade: { sessionManager: { getSessionId: () => "test-session" } },
				applyRuntimeSettings: () => {},
				programStatus: { reset: () => {} },
				renderCurrentSessionState: () => events.push("render"),
				bindCurrentSessionExtensions: async () => {
					events.push("bind");
					await harness.session.bindExtensions({
						uiContext: createTestUiContext(),
						mode: "tui",
					});
				},
				subscribeToAgent: () => {
					events.push("subscribe");
					harness.session.subscribe((event) => {
						if (event.type !== "message_start" && event.type !== "message_end") {
							return;
						}
						events.push(`${event.type}:${event.message.role}:${getMessageText(event)}`);
					});
				},
				updateAvailableProviderCount: async () => {},
				updateEditorBorderColor: () => {},
				updateTerminalTitle: () => {},
				syncEmptySessionScreen: () => {},
			};

			await interactiveModePrototype.rebindCurrentSession.call(context, { renderBeforeBind: true });
			await harness.session.agent.waitForIdle();

			expect(events.slice(0, 3)).toEqual(["render", "subscribe", "bind"]);
			expect(events).toContain("message_start:user:user from start");
			expect(events).toContain("message_end:user:user from start");
			expect(events).toContain("message_end:assistant:assistant from start");
		} finally {
			harness.cleanup();
		}
	});

	it("runs the reload render hook before reload session_start handlers can notify", async () => {
		const events: string[] = [];
		const beforeSessionStart = vi.fn(() => {
			events.push("render");
		});
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_start", (event, ctx) => {
						events.push(`start:${event.reason}`);
						ctx.ui.notify(`notify:${event.reason}`, "error");
					});
				},
			],
		});

		try {
			await harness.session.bindExtensions({
				uiContext: createTestUiContext({ notify: (message) => events.push(message) }),
				mode: "tui",
			});
			expect(events).toEqual(["start:startup", "notify:startup"]);

			events.length = 0;
			await harness.session.reload({ beforeSessionStart });

			expect(beforeSessionStart).toHaveBeenCalledTimes(1);
			expect(events).toEqual(["render", "start:reload", "notify:reload"]);
		} finally {
			harness.cleanup();
		}
	});

	it("refreshes hideThinkingBlock before rebuilding chat during reload", async () => {
		initTheme("dark", false);
		const events: string[] = [];
		const context = createReloadCommandContext({
			facade: {
				settingsManager: { getHideThinkingBlock: () => true },
				reload: async () => {
					events.push("reload");
				},
			},
			rebuildChatFromMessages: () => {
				events.push(`rebuild:${context.hideThinkingBlock}`);
			},
		});

		await interactiveModePrototype.handleReloadCommand.call(context);

		expect(context.hideThinkingBlock).toBe(true);
		expect(events).toEqual(["reload", "rebuild:true"]);
	});

	it("keeps the reload blocker focused until async reload completes", async () => {
		initTheme("dark", false);
		const editor = {};
		let focused: unknown;
		let chatRestored = false;
		let markReloadWaiting!: () => void;
		let finishReload!: () => void;
		const reloadWaiting = new Promise<void>((resolve) => {
			markReloadWaiting = resolve;
		});
		const reloadFinished = new Promise<void>((resolve) => {
			finishReload = resolve;
		});

		const context = createReloadCommandContext({
			editor,
			facade: {
				reload: async () => {
					markReloadWaiting();
					await reloadFinished;
				},
			},
			ui: {
				setFocus: (component) => {
					focused = component;
				},
			},
			rebuildChatFromMessages: () => {
				chatRestored = true;
			},
		});

		const reloadPromise = interactiveModePrototype.handleReloadCommand.call(context);
		await reloadWaiting;

		expect(chatRestored).toBe(false);
		expect(focused).not.toBe(editor);

		finishReload();
		await reloadPromise;

		expect(chatRestored).toBe(true);
		expect(focused).toBe(editor);
	});
});
