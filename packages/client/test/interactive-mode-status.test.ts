import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { QuietStartup } from "../../coding-agent/src/core/settings-manager.ts";
import type { SourceInfo } from "../../coding-agent/src/core/source-info.ts";
import { Text } from "../../tui/src/components/text.ts";
import { Container, type TUI } from "../../tui/src/tui.ts";
import type { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { AuthSelectorProvider } from "../src/components/oauth-selector.ts";
import { InteractiveMode } from "../src/interactive-mode.ts";
import { createInteractiveContext } from "./interactive-mode-context.ts";
import { initDarkTheme } from "./theme-fixture.ts";

function renderLastLine(container: Container, width = 120): string {
	const last = container.children[container.children.length - 1];
	if (!last) return "";
	return last.render(width).join("\n");
}

function renderAll(container: Container, width = 120): string {
	return container.children.flatMap((child) => child.render(width)).join("\n");
}

async function _flushTui(tui: TUI, terminal: VirtualTerminal): Promise<void> {
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
		initDarkTheme();
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
	beforeAll(() => initDarkTheme());

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
		initDarkTheme();
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
