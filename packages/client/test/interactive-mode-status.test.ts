import { type AutocompleteProvider, CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { AutocompleteProviderFactory } from "../../coding-agent/src/core/extensions/types.ts";
import type { QuietStartup } from "../../coding-agent/src/core/settings-manager.ts";
import type { SourceInfo } from "../../coding-agent/src/core/source-info.ts";
import { initTheme } from "../../coding-agent/src/core/theme/theme.ts";
import { Text } from "../../tui/src/components/text.ts";
import { type Component, Container, type Focusable, type TUI } from "../../tui/src/tui.ts";
import { TuiMainScreen } from "../../tui/src/tui-main-screen.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { AuthSelectorProvider } from "../src/components/oauth-selector.ts";
import { InteractiveMode } from "../src/interactive-mode.ts";
import { createInteractiveContext } from "./interactive-mode-context.ts";

function renderLastLine(container: Container, width = 120): string {
	const last = container.children[container.children.length - 1];
	if (!last) return "";
	return last.render(width).join("\n");
}

function renderAll(container: Container, width = 120): string {
	return container.children.flatMap((child) => child.render(width)).join("\n");
}

class TestFocusableComponent implements Component, Focusable {
	focused = false;
	inputs: string[] = [];
	private readonly label: string;
	private text = "";

	constructor(label: string) {
		this.label = label;
	}

	handleInput(data: string): void {
		this.inputs.push(data);
	}

	getText(): string {
		return this.text;
	}

	setText(text: string): void {
		this.text = text;
	}

	render(): string[] {
		return [this.label];
	}

	invalidate(): void {}
}

async function flushTui(tui: TUI, terminal: VirtualTerminal): Promise<void> {
	tui.requestRender(true);
	await Promise.resolve();
	await terminal.waitForRender();
}

function normalizeRenderedOutput(container: Container, width = 220): string {
	return renderAll(container, width)
		.replace(/\u001b\[[0-9;]*m/g, "")
		.replace(/\\/g, "/")
		.split("\n")
		.map((line) => line.replace(/\s+$/g, ""))
		.join("\n")
		.trim();
}

describe("InteractiveMode.showStatus", () => {
	beforeAll(() => {
		// showStatus uses the global theme instance
		initTheme("dark");
	});

	test("coalesces immediately-sequential status messages", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_ONE");

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// second status updates the previous line instead of appending
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
		expect(renderLastLine(fakeThis.chatContainer)).not.toContain("STATUS_ONE");
	});

	test("appends a new status line if something else was added in between", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);

		// Something else gets added to the chat in between status updates
		fakeThis.chatContainer.addChild({ render: () => ["OTHER"], invalidate: () => {} });
		expect(fakeThis.chatContainer.children).toHaveLength(3);

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// adds spacer + text
		expect(fakeThis.chatContainer.children).toHaveLength(5);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
	});
});

describe("InteractiveMode.showManagedToolStatus", () => {
	beforeAll(() => initTheme("dark"));

	test("renders tool updates as one contiguous group", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			managedToolStatusStarted: false,
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};
		const showManagedToolStatus = (InteractiveMode as any).prototype.showManagedToolStatus;

		showManagedToolStatus.call(fakeThis, { type: "info", message: "fd downloading" });
		showManagedToolStatus.call(fakeThis, { type: "info", message: "rg downloading" });
		showManagedToolStatus.call(fakeThis, { type: "warning", message: "rg failed" });

		expect(fakeThis.chatContainer.children).toHaveLength(4);
		expect(normalizeRenderedOutput(fakeThis.chatContainer)).toBe(
			"fd downloading\n rg downloading\n Warning: rg failed",
		);
	});
});

describe("InteractiveMode.setToolsExpanded", () => {
	test("applies expansion state to the active header and chat entries", () => {
		const header = { setExpanded: vi.fn() };
		const chatChild = { setExpanded: vi.fn() };
		const fakeThis: any = {
			toolOutputExpanded: false,
			customHeader: undefined,
			builtInHeader: header,
			chatContainer: { children: [chatChild] },
			ui: { requestRender: vi.fn() },
			showStatus: vi.fn(),
		};

		(InteractiveMode as any).prototype.setToolsExpanded.call(fakeThis, true);

		expect(fakeThis.toolOutputExpanded).toBe(true);
		expect(header.setExpanded).toHaveBeenCalledWith(true);
		expect(chatChild.setExpanded).toHaveBeenCalledWith(true);
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Tool output: expanded");
	});
});

describe("InteractiveMode.createExtensionUIContext setTheme", () => {
	test("persists theme changes to settings manager", () => {
		initTheme("dark");

		let currentTheme = "dark";
		const settingsManager = {
			getTheme: vi.fn(() => currentTheme),
			setTheme: vi.fn((theme: string) => {
				currentTheme = theme;
			}),
		};
		const fakeThis: any = createInteractiveContext({
			facade: { settingsManager },
			themeController: {
				setThemeInstance: vi.fn(() => ({ success: true })),
				setThemeName: vi.fn(() => {
					fakeThis.ui.requestRender();
					return { success: true };
				}),
			},
			ui: { requestRender: vi.fn() },
		});

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("light");

		expect(result.success).toBe(true);
		expect(fakeThis.themeController.setThemeName).toHaveBeenCalledWith("light");
		expect(settingsManager.setTheme).toHaveBeenCalledWith("light");
		expect(currentTheme).toBe("light");
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);
	});

	test("does not persist invalid theme names", () => {
		initTheme("dark");

		const settingsManager = {
			getTheme: vi.fn(() => "dark"),
			setTheme: vi.fn(),
		};
		const fakeThis: any = createInteractiveContext({
			facade: { settingsManager },
			themeController: {
				setThemeInstance: vi.fn(() => ({ success: true })),
				setThemeName: vi.fn(() => ({ success: false, error: "Theme not found" })),
			},
			ui: { requestRender: vi.fn() },
		});

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("__missing_theme__");

		expect(result.success).toBe(false);
		expect(fakeThis.themeController.setThemeName).toHaveBeenCalledWith("__missing_theme__");
		expect(settingsManager.setTheme).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).not.toHaveBeenCalled();
	});
});

describe("InteractiveMode.showExtensionCustom", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("overlay custom UI reclaims input after non-overlay custom UI closes", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui: TUI = new TuiMainScreen(terminal);
		const editorContainer = new Container();
		const editor = new TestFocusableComponent("EDITOR");
		const palette = new TestFocusableComponent("PALETTE");
		const overlay = new TestFocusableComponent("OVERLAY");
		const replacement = new TestFocusableComponent("REPLACEMENT");
		let closeOverlay: (value: string) => void = () => {
			throw new Error("closeOverlay was not initialized");
		};
		let closeReplacement: (value: string) => void = () => {
			throw new Error("closeReplacement was not initialized");
		};
		const fakeThis = {
			editor,
			editorContainer,
			keybindings: {},
			ui,
			disposeActiveSelector: vi.fn(),
		};
		const showExtensionCustom = <T>(
			factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (result: T) => void) => Component,
			options?: { overlay?: boolean },
		): Promise<T> =>
			(InteractiveMode as any).prototype.showExtensionCustom.call(fakeThis, factory, options) as Promise<T>;

		editorContainer.addChild(editor);
		ui.addChild(editorContainer);
		ui.addChild(palette);
		ui.setFocus(palette);
		ui.start();
		try {
			const overlayPromise = showExtensionCustom<string>(
				(_tui, _theme, _keybindings, done) => {
					closeOverlay = done;
					return overlay;
				},
				{ overlay: true },
			);
			await flushTui(ui, terminal);
			expect(overlay.focused).toBe(true);

			const replacementPromise = showExtensionCustom<string>((_tui, _theme, _keybindings, done) => {
				closeReplacement = done;
				return replacement;
			});
			await flushTui(ui, terminal);
			expect(replacement.focused).toBe(true);

			closeReplacement("done");
			await replacementPromise;
			await flushTui(ui, terminal);
			terminal.sendInput("x");
			await flushTui(ui, terminal);

			expect(overlay.inputs).toEqual(["x"]);
			expect(editor.inputs).toEqual([]);
			expect(overlay.focused).toBe(true);

			closeOverlay("closed");
			await overlayPromise;
		} finally {
			ui.stop();
		}
	});

	// Regression test for #10648: closing a lower overlay removed the topmost overlay instead.
	test.each([
		{ lowerKind: "capturing", nonCapturing: false },
		{ lowerKind: "non-capturing", nonCapturing: true },
	])(
		"closing a lower $lowerKind overlay custom UI removes its own overlay, not the topmost one",
		async ({ nonCapturing }) => {
			const terminal = new VirtualTerminal(80, 24);
			const ui: TUI = new TuiMainScreen(terminal);
			const editorContainer = new Container();
			const editor = new TestFocusableComponent("EDITOR");
			const lower = new TestFocusableComponent("LOWER");
			const upper = new TestFocusableComponent("UPPER");
			let closeLower: (value: string) => void = () => {
				throw new Error("closeLower was not initialized");
			};
			let closeUpper: (value: string) => void = () => {
				throw new Error("closeUpper was not initialized");
			};
			const fakeThis = {
				editor,
				editorContainer,
				keybindings: {},
				ui,
				disposeActiveSelector: vi.fn(),
			};
			const showExtensionCustom = <T>(
				factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (result: T) => void) => Component,
				options?: { overlay?: boolean; overlayOptions?: { nonCapturing?: boolean } },
			): Promise<T> =>
				(InteractiveMode as any).prototype.showExtensionCustom.call(fakeThis, factory, options) as Promise<T>;

			editorContainer.addChild(editor);
			ui.addChild(editorContainer);
			ui.setFocus(editor);
			ui.start();
			try {
				const lowerPromise = showExtensionCustom<string>(
					(_tui, _theme, _keybindings, done) => {
						closeLower = done;
						return lower;
					},
					{ overlay: true, overlayOptions: { nonCapturing } },
				);
				await flushTui(ui, terminal);
				const upperPromise = showExtensionCustom<string>(
					(_tui, _theme, _keybindings, done) => {
						closeUpper = done;
						return upper;
					},
					{ overlay: true },
				);
				await flushTui(ui, terminal);
				expect(upper.focused).toBe(true);

				closeLower("lower closed");
				await expect(lowerPromise).resolves.toBe("lower closed");
				await flushTui(ui, terminal);

				const viewport = terminal.getViewport().join("\n");
				expect(viewport).toContain("UPPER");
				expect(viewport).not.toContain("LOWER");
				terminal.sendInput("x");
				await flushTui(ui, terminal);
				expect(upper.inputs).toEqual(["x"]);
				expect(lower.inputs).toEqual([]);

				closeUpper("upper closed");
				await expect(upperPromise).resolves.toBe("upper closed");
				await flushTui(ui, terminal);
				expect(ui.hasOverlay()).toBe(false);
				expect(editor.focused).toBe(true);
			} finally {
				ui.stop();
			}
		},
	);
});

describe("InteractiveMode.createExtensionUIContext addAutocompleteProvider", () => {
	test("stores wrapper factories and rebuilds autocomplete immediately", () => {
		const wrapper: AutocompleteProviderFactory = (current) => current;
		const fakeThis = {
			autocompleteProviderWrappers: [] as AutocompleteProviderFactory[],
			setupAutocompleteProvider: vi.fn(),
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		uiContext.addAutocompleteProvider(wrapper);

		expect(fakeThis.autocompleteProviderWrappers).toEqual([wrapper]);
		expect(fakeThis.setupAutocompleteProvider).toHaveBeenCalledTimes(1);
	});
});

describe("InteractiveMode.setupAutocompleteProvider", () => {
	test("stacks wrapper factories over a fresh base provider", () => {
		const defaultEditor = { setAutocompleteProvider: vi.fn() };
		const customEditor = { setAutocompleteProvider: vi.fn() };
		const calls: string[] = [];

		const wrap1: AutocompleteProviderFactory = (current): AutocompleteProvider => ({
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				calls.push("getSuggestions:wrap1");
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				calls.push("applyCompletion:wrap1");
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				calls.push("shouldTrigger:wrap1");
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		});
		const wrap2: AutocompleteProviderFactory = (current): AutocompleteProvider => ({
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				calls.push("getSuggestions:wrap2");
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				calls.push("applyCompletion:wrap2");
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				calls.push("shouldTrigger:wrap2");
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		});

		const fakeThis = {
			createBaseAutocompleteProvider: () => new CombinedAutocompleteProvider([], "/tmp/project", undefined),
			defaultEditor,
			editor: customEditor,
			autocompleteProviderWrappers: [wrap1, wrap2],
		};

		(InteractiveMode as any).prototype.setupAutocompleteProvider.call(fakeThis);

		expect(defaultEditor.setAutocompleteProvider).toHaveBeenCalledTimes(1);
		expect(customEditor.setAutocompleteProvider).toHaveBeenCalledTimes(1);
		const provider = defaultEditor.setAutocompleteProvider.mock.calls[0]?.[0] as AutocompleteProvider;
		expect(provider).toBe(customEditor.setAutocompleteProvider.mock.calls[0]?.[0]);
		expect(provider.shouldTriggerFileCompletion?.(["foo"], 0, 3)).toBe(true);
		expect(calls).toEqual(["shouldTrigger:wrap2", "shouldTrigger:wrap1"]);
	});

	test("merges triggerCharacters from wrapper factories", () => {
		const defaultEditor = { setAutocompleteProvider: vi.fn() };
		const customEditor = { setAutocompleteProvider: vi.fn() };
		const passThrough =
			(triggerCharacters: string[]): AutocompleteProviderFactory =>
			(current) => ({
				triggerCharacters,
				getSuggestions: (lines, cursorLine, cursorCol, options) =>
					current.getSuggestions(lines, cursorLine, cursorCol, options),
				applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
					current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
			});

		const fakeThis = {
			createBaseAutocompleteProvider: () => new CombinedAutocompleteProvider([], "/tmp/project", undefined),
			defaultEditor,
			editor: customEditor,
			autocompleteProviderWrappers: [passThrough(["$"]), passThrough(["!"])],
		};

		(
			InteractiveMode as unknown as {
				prototype: { setupAutocompleteProvider: (this: typeof fakeThis) => void };
			}
		).prototype.setupAutocompleteProvider.call(fakeThis);

		const provider = defaultEditor.setAutocompleteProvider.mock.calls[0]?.[0] as AutocompleteProvider;
		expect(provider.triggerCharacters).toEqual(["$", "!"]);
	});
});

describe("InteractiveMode.createBaseAutocompleteProvider", () => {
	test("matches model command arguments across provider/model order", async () => {
		type TestModel = { id: string; provider: string; name: string };
		type FakeInteractiveMode = {
			facade: {
				scopedModels: Array<{ model: TestModel }>;
				modelRuntime: { getAvailableSnapshot: () => TestModel[] };
				promptTemplates: [];
				extensionRunner: { getRegisteredCommands: () => [] };
				resourceLoader: { getSkills: () => { skills: [] } };
				settingsManager: { getEnableSkillCommands: () => boolean };
				sessionManager: { getCwd: () => string };
			};
			skillCommands: Map<string, string>;
			fdPath: null;
		};

		const createBaseAutocompleteProvider = (
			InteractiveMode as unknown as {
				prototype: { createBaseAutocompleteProvider(this: FakeInteractiveMode): AutocompleteProvider };
			}
		).prototype.createBaseAutocompleteProvider;
		const models = [
			{ id: "gpt-5.2-codex", provider: "github-copilot", name: "GPT-5.2 Codex" },
			{ id: "gpt-5.5", provider: "openai-codex", name: "GPT-5.5" },
		];
		const fakeThis: FakeInteractiveMode = createInteractiveContext({
			facade: {
				scopedModels: [],
				modelRuntime: { getAvailableSnapshot: () => models },
				promptTemplates: [],
				extensionRunner: { getRegisteredCommands: () => [] },
				resourceLoader: { getSkills: () => ({ skills: [] }) },
				settingsManager: { getEnableSkillCommands: () => false },
				sessionManager: { getCwd: () => "/tmp" },
			},
			skillCommands: new Map(),
			fdPath: null,
		});

		const provider = createBaseAutocompleteProvider.call(fakeThis);
		const line = "/model codexgpt";
		const suggestions = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});

		expect(suggestions?.items.map((item) => item.value)).toEqual([
			"openai-codex/gpt-5.5",
			"github-copilot/gpt-5.2-codex",
		]);
	});

	test("matches login command arguments by provider id and name", async () => {
		type FakeInteractiveMode = {
			facade: {
				scopedModels: [];
				modelRuntime: { getAvailableSnapshot: () => [] };
				promptTemplates: [];
				extensionRunner: { getRegisteredCommands: () => [] };
				resourceLoader: { getSkills: () => { skills: [] } };
				settingsManager: { getEnableSkillCommands: () => boolean };
				sessionManager: { getCwd: () => string };
			};
			skillCommands: Map<string, string>;
			fdPath: null;
			getLoginProviderOptions: () => AuthSelectorProvider[];
		};

		const createBaseAutocompleteProvider = (
			InteractiveMode as unknown as {
				prototype: { createBaseAutocompleteProvider(this: FakeInteractiveMode): AutocompleteProvider };
			}
		).prototype.createBaseAutocompleteProvider;
		const fakeThis: FakeInteractiveMode = createInteractiveContext({
			facade: {
				scopedModels: [],
				modelRuntime: { getAvailableSnapshot: () => [] },
				promptTemplates: [],
				extensionRunner: { getRegisteredCommands: () => [] },
				resourceLoader: { getSkills: () => ({ skills: [] }) },
				settingsManager: { getEnableSkillCommands: () => false },
				sessionManager: { getCwd: () => "/tmp" },
			},
			skillCommands: new Map(),
			fdPath: null,
			getLoginProviderOptions: () => [
				{ id: "anthropic", name: "Anthropic", authType: "oauth", subscription: true },
				{ id: "anthropic", name: "Anthropic", authType: "api_key", subscription: true },
				{ id: "openai", name: "OpenAI", authType: "api_key" },
				{ id: "radius", name: "Radius", authType: "oauth", subscription: false },
			],
		});

		const provider = createBaseAutocompleteProvider.call(fakeThis);
		const line = "/login subscription anthrop";
		const suggestions = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});

		expect(suggestions?.items).toEqual([
			{
				value: "anthropic",
				label: "anthropic",
				description: "Anthropic · subscription/API key",
			},
		]);

		// OAuth sign-in without a subscription, such as Radius, is an account.
		const radiusLine = "/login radius";
		const radiusSuggestions = await provider.getSuggestions([radiusLine], 0, radiusLine.length, {
			signal: new AbortController().signal,
		});
		expect(radiusSuggestions?.items).toEqual([{ value: "radius", label: "radius", description: "Radius · account" }]);
	});
});
describe("InteractiveMode.showResourceDiagnostics", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	function createShowResourceDiagnosticsThis(options: {
		skills?: Array<{ filePath: string; name: string; sourceInfo?: SourceInfo }>;
		skillDiagnostics?: Array<{ type: "warning" | "error" | "collision"; message: string }>;
		promptDiagnostics?: Array<{ type: "warning" | "error"; message: string }>;
		extensionErrors?: Array<{ path: string; error: string }>;
		themeDiagnostics?: Array<{ type: "warning" | "error"; message: string }>;
	}) {
		const fakeThis: any = createInteractiveContext({
			resourceDiagnosticsContainer: new Container(),
			facade: {
				promptTemplates: [],
				extensionRunner: {
					getCommandDiagnostics: () => [],
					getShortcutDiagnostics: () => [],
				},
				resourceLoader: {
					getSkills: () => ({
						skills: options.skills ?? [],
						diagnostics: options.skillDiagnostics ?? [],
					}),
					getPrompts: () => ({ prompts: [], diagnostics: options.promptDiagnostics ?? [] }),
					getExtensions: () => ({
						extensions: [],
						errors: options.extensionErrors ?? [],
						runtime: {},
					}),
					getThemes: () => ({ themes: [], diagnostics: options.themeDiagnostics ?? [] }),
				},
			},
			formatDisplayPath: (p: string) => (InteractiveMode as any).prototype.formatDisplayPath.call(fakeThis, p),
			isPackageSource: (sourceInfo?: SourceInfo) =>
				(InteractiveMode as any).prototype.isPackageSource.call(fakeThis, sourceInfo),
			getShortPath: (p: string, sourceInfo?: SourceInfo) =>
				(InteractiveMode as any).prototype.getShortPath.call(fakeThis, p, sourceInfo),
			getDisplaySourceInfo: (sourceInfo?: SourceInfo) =>
				(InteractiveMode as any).prototype.getDisplaySourceInfo.call(fakeThis, sourceInfo),
			findSourceInfoForPath: (p: string, sourceInfos: Map<string, SourceInfo>) =>
				(InteractiveMode as any).prototype.findSourceInfoForPath.call(fakeThis, p, sourceInfos),
			formatPathWithSource: (p: string, sourceInfo?: SourceInfo) =>
				(InteractiveMode as any).prototype.formatPathWithSource.call(fakeThis, p, sourceInfo),
			formatDiagnostics: () => "diagnostics",
			getBuiltInCommandConflictDiagnostics: () => [],
		});

		return fakeThis;
	}

	test("renders nothing when there are no diagnostics", () => {
		const fakeThis = createShowResourceDiagnosticsThis({});

		(InteractiveMode as any).prototype.showResourceDiagnostics.call(fakeThis);

		expect(fakeThis.resourceDiagnosticsContainer.children).toHaveLength(0);
	});

	test("renders skill conflicts", () => {
		const fakeThis = createShowResourceDiagnosticsThis({
			skillDiagnostics: [{ type: "warning", message: "duplicate skill name" }],
			promptDiagnostics: [{ type: "error", message: "broken prompt" }],
			extensionErrors: [{ path: "/tmp/ext/index.ts", error: "failed to load" }],
			themeDiagnostics: [{ type: "warning", message: "duplicate theme" }],
		});

		(InteractiveMode as any).prototype.showResourceDiagnostics.call(fakeThis);

		const output = renderAll(fakeThis.resourceDiagnosticsContainer);
		expect(output).toContain("[Skill conflicts]");
	});

	test("clears stale diagnostics before rendering", () => {
		const fakeThis = createShowResourceDiagnosticsThis({
			skillDiagnostics: [{ type: "warning", message: "duplicate skill name" }],
		});
		fakeThis.resourceDiagnosticsContainer.addChild(new Text("stale diagnostics", 0, 0));

		(InteractiveMode as any).prototype.showResourceDiagnostics.call(fakeThis);

		const output = renderAll(fakeThis.resourceDiagnosticsContainer);
		expect(output).not.toContain("stale diagnostics");
		expect(output).toContain("[Skill conflicts]");
	});
});

describe("InteractiveMode startup visibility", () => {
	function createVisibilityThis(options: {
		quietStartup: QuietStartup;
		verbose?: boolean;
		continuesSession?: boolean;
	}) {
		const fakeThis: any = createInteractiveContext({
			options: { verbose: options.verbose ?? false },
			launchContinuesSession: options.continuesSession ?? false,
			facade: {
				settingsManager: {
					getQuietStartup: () => options.quietStartup,
				},
			},
		});
		return fakeThis;
	}

	test("hides the startup header with full quiet startup unless verbose", () => {
		const quiet = createVisibilityThis({ quietStartup: true });
		expect((InteractiveMode as any).prototype.shouldShowStartupHeader.call(quiet)).toBe(false);
		const verbose = createVisibilityThis({ quietStartup: true, verbose: true });
		expect((InteractiveMode as any).prototype.shouldShowStartupHeader.call(verbose)).toBe(true);
	});

	test("keeps the startup header for a continued launch", () => {
		const resumed = createVisibilityThis({ quietStartup: false, continuesSession: true });
		expect((InteractiveMode as any).prototype.shouldShowStartupHeader.call(resumed)).toBe(true);
		const quiet = createVisibilityThis({ quietStartup: true, continuesSession: true });
		expect((InteractiveMode as any).prototype.shouldShowStartupHeader.call(quiet)).toBe(false);
	});

	test("keeps the empty-session screen away once the intro was used", () => {
		const fakeThis: any = createInteractiveContext({
			introAllowed: false,
			facade: {
				settingsManager: { getThreeDEmptySession: () => true },
				state: { messages: [] },
			},
		});
		expect((InteractiveMode as any).prototype.shouldShowEmptySessionScreen.call(fakeThis)).toBe(false);
		fakeThis.introAllowed = true;
		expect((InteractiveMode as any).prototype.shouldShowEmptySessionScreen.call(fakeThis)).toBe(true);
	});

	test("drops the intro when the session is replaced from inside", () => {
		let invalidated = false;
		const fakeThis: any = {
			introShown: true,
			builtInHeader: {
				invalidate: () => {
					invalidated = true;
				},
			},
			ui: { requestRender: () => {} },
		};

		(InteractiveMode as any).prototype.hideStartupIntro.call(fakeThis);

		expect(fakeThis.introShown).toBe(false);
		expect(invalidated).toBe(true);
	});

	test("drops the intro when the first user message arrives", async () => {
		const calls: string[] = [];
		const fakeThis: any = {
			isInitialized: true,
			footer: { invalidate: () => {} },
			programStatus: { handleEvent: () => {} },
			hideStartupIntro: () => calls.push("hide"),
			renderUserMessage: () => calls.push("render"),
			updatePendingMessagesDisplay: () => {},
			ui: { requestRender: () => {} },
		};

		await (InteractiveMode as any).prototype.handleEvent.call(fakeThis, {
			type: "message_start",
			message: { role: "user", content: [{ type: "text", text: "hello" }] },
		});

		expect(calls).toEqual(["hide", "render"]);
	});

	test("hides the model scope line with header-only quiet startup", () => {
		const headerOnly = createVisibilityThis({ quietStartup: "header" });
		expect((InteractiveMode as any).prototype.shouldShowStartupHeader.call(headerOnly)).toBe(true);
		expect((InteractiveMode as any).prototype.shouldShowModelScope.call(headerOnly)).toBe(false);
		const verbose = createVisibilityThis({ quietStartup: "header", verbose: true });
		expect((InteractiveMode as any).prototype.shouldShowModelScope.call(verbose)).toBe(true);
	});
});
