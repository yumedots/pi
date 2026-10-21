import { Container } from "@earendil-works/pi-tui";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../coding-agent/src/core/session-manager.ts";
import { SettingsManager } from "../../coding-agent/src/core/settings-manager.ts";
import { initTheme } from "../../coding-agent/src/core/theme/theme.ts";
import { assistantMsg, userMsg } from "../../coding-agent/test/utilities.ts";
import type { StatusIndicator } from "../src/components/status-indicator.ts";
import type { TreeSelectorComponent } from "../src/components/tree-selector.ts";
import { InteractiveMode } from "../src/interactive-mode.ts";
import { createInteractiveContext } from "./interactive-mode-context.ts";

const busyMessage = "Wait for the current compaction or tree navigation to finish before navigating the session tree.";

type TreeFacade = {
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	isStreaming: boolean;
	isCompacting: boolean;
	abort: Mock<() => Promise<void>>;
	abortBranchSummary: Mock<() => Promise<void>>;
	navigateTree: Mock<() => Promise<{ cancelled: boolean }>>;
};

function createTreeUI() {
	const sessionManager = SessionManager.inMemory();
	const targetId = sessionManager.appendMessage(userMsg("first"));
	sessionManager.appendMessage(assistantMsg("reply"));
	let selector: TreeSelectorComponent | undefined;
	const onEscape = vi.fn();
	const facade: TreeFacade = {
		sessionManager,
		settingsManager: SettingsManager.inMemory(),
		isStreaming: false,
		isCompacting: false,
		abort: vi.fn(async () => {
			facade.isStreaming = false;
		}),
		abortBranchSummary: vi.fn(async () => {}),
		navigateTree: vi.fn(async () => {
			if (facade.isCompacting) throw new Error(busyMessage);
			return { cancelled: false };
		}),
	};
	const ui = createInteractiveContext({
		facade,
		defaultEditor: { onEscape },
		editor: { getText: () => "", setText: vi.fn() },
		chatContainer: new Container(),
		isInitialized: true,
		footer: { invalidate: vi.fn() },
		ui: { terminal: { rows: 24, setProgress: vi.fn() }, requestRender: vi.fn() },
		showSelector: (
			create: (done: () => void) => { component: TreeSelectorComponent; focus: TreeSelectorComponent },
		) => {
			selector = create(vi.fn()).component;
		},
		showExtensionSelector: vi.fn(async () => "No summary"),
		// Dispose newly created indicators so a failing regression cannot leak spinner timers.
		showStatusIndicator: vi.fn((indicator: StatusIndicator) => indicator.dispose()),
		clearStatusIndicator: vi.fn(),
		restoreQueuedMessagesToEditor: vi.fn(),
		renderInitialMessages: vi.fn(),
		showStatus: vi.fn(),
		showError: vi.fn(),
		flushCompactionQueue: vi.fn(async () => {}),
	});
	const showTreeSelector = Reflect.get(InteractiveMode.prototype, "showTreeSelector") as (this: typeof ui) => void;
	showTreeSelector.call(ui);

	return {
		ui,
		onEscape,
		targetId,
		async select() {
			expect(selector).toBeDefined();
			await selector!.getTreeList().onSelect!(targetId);
		},
	};
}

describe("InteractiveMode tree navigation availability", () => {
	beforeEach(() => initTheme("dark"));

	// Regression for #9178 / PR #9179: rejection must not replace the active operation's UI.
	it.each(["Summarize", "No summary"])("preserves operation UI when choosing %s while busy", async (choice) => {
		const { ui, onEscape, select } = createTreeUI();
		const originalLeafId = ui.facade.sessionManager.getLeafId();
		ui.showExtensionSelector.mockImplementation(async () => {
			// Compaction or another navigation can start while the dialog is open.
			ui.facade.isCompacting = true;
			return choice;
		});

		await select();

		expect(ui.showError).toHaveBeenCalledWith(busyMessage);
		expect(ui.showStatusIndicator).not.toHaveBeenCalled();
		expect(ui.clearStatusIndicator).not.toHaveBeenCalled();
		expect(ui.defaultEditor.onEscape).toBe(onEscape);
		expect(ui.facade.navigateTree).not.toHaveBeenCalled();
		expect(ui.facade.abort).not.toHaveBeenCalled();
		expect(ui.facade.sessionManager.getLeafId()).toBe(originalLeafId);
	});

	it("allows navigation when compaction finishes while the dialog is open", async () => {
		const { ui, targetId, select } = createTreeUI();
		ui.facade.isCompacting = true;
		ui.showExtensionSelector.mockImplementation(async () => {
			ui.facade.isCompacting = false;
			return "No summary";
		});

		await select();

		expect(ui.facade.navigateTree).toHaveBeenCalledWith(targetId, {
			summarize: false,
			customInstructions: undefined,
		});
		expect(ui.showError).not.toHaveBeenCalled();
	});

	it("still aborts an active response before navigating", async () => {
		const { ui, select } = createTreeUI();
		ui.facade.isStreaming = true;
		ui.facade.navigateTree.mockImplementation(async () => {
			expect(ui.facade.isStreaming).toBe(false);
			expect(ui.restoreQueuedMessagesToEditor).toHaveBeenCalledOnce();
			return { cancelled: false };
		});

		await select();

		expect(ui.facade.abort).toHaveBeenCalledOnce();
		expect(ui.facade.navigateTree).toHaveBeenCalledOnce();
		expect(ui.showError).not.toHaveBeenCalled();
	});

	it("rechecks availability after the response abort settles", async () => {
		const { ui, onEscape, select } = createTreeUI();
		ui.facade.isStreaming = true;
		ui.showExtensionSelector.mockResolvedValue("Summarize");
		ui.facade.abort.mockImplementation(async () => {
			ui.facade.isStreaming = false;
			ui.facade.isCompacting = true;
		});

		await select();

		expect(ui.facade.abort).toHaveBeenCalledOnce();
		expect(ui.showError).toHaveBeenCalledWith(busyMessage);
		expect(ui.showStatusIndicator).not.toHaveBeenCalled();
		expect(ui.clearStatusIndicator).not.toHaveBeenCalled();
		expect(ui.defaultEditor.onEscape).toBe(onEscape);
		expect(ui.facade.navigateTree).not.toHaveBeenCalled();
	});
});
