import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/interactive-mode.ts";
import { createInteractiveContext } from "./interactive-mode-context.ts";

type CloneCommandContext = {
	facade: {
		sessionManager: { getLeafId: () => string | null };
		clone: () => Promise<{ cancelled: boolean }>;
	};
	renderCurrentSessionState: () => void;
	editor: { setText: (text: string) => void };
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	ui: { requestRender: () => void };
};

type InteractiveModePrototype = {
	handleCloneCommand(this: CloneCommandContext): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("InteractiveMode /clone", () => {
	it("clones the current leaf into a new session", async () => {
		const clone = vi.fn(async () => ({ cancelled: false }));
		const renderCurrentSessionState = vi.fn();
		const setText = vi.fn();
		const showStatus = vi.fn();
		const showError = vi.fn();
		const requestRender = vi.fn();

		const context: CloneCommandContext = createInteractiveContext({
			facade: {
				sessionManager: { getLeafId: () => "leaf-123" },
				clone,
			},
			renderCurrentSessionState,
			editor: { setText },
			showStatus,
			showError,
			ui: { requestRender },
		});

		await interactiveModePrototype.handleCloneCommand.call(context);

		expect(clone).toHaveBeenCalledOnce();
		expect(renderCurrentSessionState).not.toHaveBeenCalled();
		expect(setText).toHaveBeenCalledWith("");
		expect(showStatus).toHaveBeenCalledWith("Cloned to new session");
		expect(showError).not.toHaveBeenCalled();
		expect(requestRender).not.toHaveBeenCalled();
	});

	it("shows a status message when there is nothing to clone", async () => {
		const clone = vi.fn(async () => ({ cancelled: false }));
		const showStatus = vi.fn();
		const showError = vi.fn();

		const context: CloneCommandContext = createInteractiveContext({
			facade: {
				sessionManager: { getLeafId: () => null },
				clone,
			},
			renderCurrentSessionState: vi.fn(),
			editor: { setText: vi.fn() },
			showStatus,
			showError,
			ui: { requestRender: vi.fn() },
		});

		await interactiveModePrototype.handleCloneCommand.call(context);

		expect(clone).not.toHaveBeenCalled();
		expect(showStatus).toHaveBeenCalledWith("Nothing to clone yet");
		expect(showError).not.toHaveBeenCalled();
	});
});
