import { afterEach, describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../../../src/interactive-mode.ts";
import { createInteractiveContext } from "../../interactive-mode-context.ts";

// Regression for https://github.com/earendil-works/pi/issues/5724
//
// `proper-lockfile` installs `signal-exit`, whose signal listener re-sends
// SIGTERM/SIGHUP when it observes no other process listeners during the same
// signal dispatch. InteractiveMode must therefore keep its signal handlers
// registered until async terminal cleanup has completed.

type ShutdownThis = {
	isShuttingDown: boolean;
	unregisterSignalHandlers: () => void;
	facade: {
		dispose: () => void;
		sessionManager: {
			isPersisted?: () => boolean;
			getSessionFile: () => string | undefined;
			getSessionId: () => string;
			usesDefaultSessionDir: () => boolean;
			getSessionDir: () => string;
		};
	};
	ui: { terminal: { drainInput: (ms: number) => Promise<void> } };
	themeController: { disableAutoSync: () => void };
	stop: () => void;
};

type InteractiveModePrototypeWithShutdown = {
	shutdown(this: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown;

class ProcessExitError extends Error {}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: (() => void) | undefined;
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return {
		promise,
		resolve: () => resolve?.(),
	};
}

async function callShutdown(context: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void> {
	try {
		await (interactiveModePrototype as InteractiveModePrototypeWithShutdown).shutdown.call(context, options);
	} catch (error) {
		if (!(error instanceof ProcessExitError)) throw error;
	}
}

describe("InteractiveMode SIGTERM shutdown with signal-exit (#5724)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("keeps signal handlers registered while signal-triggered cleanup is pending", async () => {
		vi.spyOn(process, "exit").mockImplementation((() => {
			throw new ProcessExitError();
		}) as typeof process.exit);

		const order: string[] = [];
		const drained = deferred();
		const context: ShutdownThis = createInteractiveContext({
			isShuttingDown: false,
			unregisterSignalHandlers: vi.fn(() => {
				order.push("unregister");
			}),
			facade: {
				dispose: vi.fn(() => {
					order.push("dispose");
				}),
				sessionManager: {
					isPersisted: () => false,
					getSessionFile: () => undefined,
					getSessionId: () => "test-session",
					usesDefaultSessionDir: () => true,
					getSessionDir: () => "/tmp/pi-sessions",
				},
			},
			ui: {
				terminal: {
					drainInput: vi.fn(async () => {
						order.push("drainInput");
						await drained.promise;
					}),
				},
			},
			themeController: { disableAutoSync: vi.fn() },
			stop: vi.fn(() => {
				order.push("stop");
			}),
		});

		const shutdownPromise = callShutdown(context, { fromSignal: true });
		await Promise.resolve();

		expect(order).toEqual(["dispose", "drainInput"]);
		expect(context.unregisterSignalHandlers).not.toHaveBeenCalled();

		drained.resolve();
		await shutdownPromise;

		expect(order).toEqual(["dispose", "drainInput", "stop"]);
	});
});
