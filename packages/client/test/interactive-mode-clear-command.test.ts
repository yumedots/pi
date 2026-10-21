import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/interactive-mode.ts";
import { createInteractiveContext } from "./interactive-mode-context.ts";

type ClearCommandContext = {
	clearStatusIndicator: () => void;
	facade: { newSession: () => Promise<{ cancelled: boolean }> };
	chatContainer: { children: unknown[]; addChild: (child: unknown) => void };
	ui: { requestRender: () => void };
	handleFatalRuntimeError: (prefix: string, error: unknown) => Promise<never>;
};

type InteractiveModePrototype = {
	handleClearCommand(this: ClearCommandContext): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

function createContext(newSession: () => Promise<{ cancelled: boolean }>): {
	context: ClearCommandContext;
	newSession: Mock<() => Promise<{ cancelled: boolean }>>;
} {
	const children: unknown[] = [];
	const newSessionSpy = vi.fn(newSession);
	const context: ClearCommandContext = createInteractiveContext({
		clearStatusIndicator: vi.fn(),
		facade: { newSession: newSessionSpy },
		chatContainer: {
			children,
			addChild: (child: unknown) => children.push(child),
		},
		ui: { requestRender: vi.fn() },
		handleFatalRuntimeError: vi.fn(async () => {
			throw new Error("fatal");
		}) as unknown as (prefix: string, error: unknown) => Promise<never>,
	});
	return { context, newSession: newSessionSpy };
}

describe("InteractiveMode /new", () => {
	it("starts a new session without adding a chat message", async () => {
		const { context, newSession } = createContext(async () => ({ cancelled: false }));

		await interactiveModePrototype.handleClearCommand.call(context);

		expect(newSession).toHaveBeenCalled();
		expect(context.chatContainer.children).toEqual([]);
	});

	it("adds no chat message when the new session is cancelled", async () => {
		const { context } = createContext(async () => ({ cancelled: true }));

		await interactiveModePrototype.handleClearCommand.call(context);

		expect(context.chatContainer.children).toEqual([]);
	});
});
