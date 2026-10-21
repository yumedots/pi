import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../../src/interactive-mode.ts";

type RebindContext = {
	sessionManager: { getSessionId: () => string };
	refreshSessionList: () => Promise<void>;
	facade: { sessionManager: { getSessionId: () => string } };
	unsubscribe?: () => void;
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

type InteractiveModePrototype = {
	rebindCurrentSession(this: RebindContext, options?: { renderBeforeBind?: boolean }): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("overlapping startup and replacement session rebinds", () => {
	it("does not subscribe from the stale startup rebind", async () => {
		let resolveStartupBind!: () => void;
		let resolveReplacementBind!: () => void;

		const startupBind = new Promise<void>((resolve) => {
			resolveStartupBind = resolve;
		});
		const replacementBind = new Promise<void>((resolve) => {
			resolveReplacementBind = resolve;
		});

		const subscribeToAgent = vi.fn();
		const updateTerminalTitle = vi.fn();
		let bindCount = 0;
		// The rebind notices a replaced session by its id, which the server owns.
		let currentSessionId = "startup-session";

		const context: RebindContext = {
			sessionManager: { getSessionId: () => currentSessionId },
			refreshSessionList: async () => {},
			facade: { sessionManager: { getSessionId: () => currentSessionId } },
			applyRuntimeSettings: () => {},
			programStatus: { reset: () => {} },
			renderCurrentSessionState: () => {},
			bindCurrentSessionExtensions: () => {
				bindCount += 1;
				return bindCount === 1 ? startupBind : replacementBind;
			},
			subscribeToAgent,
			updateAvailableProviderCount: async () => {},
			updateEditorBorderColor: () => {},
			updateTerminalTitle,
			syncEmptySessionScreen: () => {},
		};

		const startupRebind = interactiveModePrototype.rebindCurrentSession.call(context);
		expect(bindCount).toBe(1);

		currentSessionId = "replacement-session";
		const replacementRebind = interactiveModePrototype.rebindCurrentSession.call(context, {
			renderBeforeBind: true,
		});

		expect(bindCount).toBe(2);
		expect(subscribeToAgent).toHaveBeenCalledTimes(1);

		resolveStartupBind();
		await startupRebind;

		expect(subscribeToAgent).toHaveBeenCalledTimes(1);
		expect(updateTerminalTitle).not.toHaveBeenCalled();

		resolveReplacementBind();
		await replacementRebind;

		expect(subscribeToAgent).toHaveBeenCalledTimes(1);
		expect(updateTerminalTitle).toHaveBeenCalledTimes(1);
	});
});
