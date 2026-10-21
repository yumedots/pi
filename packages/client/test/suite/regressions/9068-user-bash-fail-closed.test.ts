import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionRuntime } from "../../../../coding-agent/src/core/agent-session-runtime.ts";
import type { ExtensionAPI, UserBashEventResult } from "../../../../coding-agent/src/core/extensions/types.ts";
import { runRpcMode } from "../../../../coding-agent/src/modes/rpc/rpc-mode.ts";
import { createHarness, type Harness } from "../../../../coding-agent/test/suite/harness.ts";
import { InteractiveMode } from "../../../src/interactive-mode.ts";

// Regression for https://github.com/earendil-works/pi/issues/9068

const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../../../../coding-agent/src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
}));

vi.mock("../../../../coding-agent/src/core/theme/theme.js", () => ({ theme: {}, SYSTEM_THEME_NAME: "system" }));

vi.mock("../../../src/components/bash-execution.js", () => ({
	BashExecutionComponent: class {
		appendOutput(): void {}
		setComplete(): void {}
	},
}));

vi.mock("../../../../coding-agent/src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		rpcIo.lineHandler = onLine;
		return () => {
			rpcIo.lineHandler = undefined;
		};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

type NodeListener = Parameters<typeof process.on>[1];

type ListenerSnapshot = {
	stdinEnd: NodeListener[];
	signals: Map<NodeJS.Signals, NodeListener[]>;
};

function takeListenerSnapshot(): ListenerSnapshot {
	const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
	return {
		stdinEnd: process.stdin.listeners("end") as NodeListener[],
		signals: new Map(signals.map((signal) => [signal, process.listeners(signal) as NodeListener[]])),
	};
}

function restoreListeners(snapshot: ListenerSnapshot): void {
	for (const listener of process.stdin.listeners("end") as NodeListener[]) {
		if (!snapshot.stdinEnd.includes(listener)) process.stdin.off("end", listener);
	}
	for (const [signal, previousListeners] of snapshot.signals) {
		for (const listener of process.listeners(signal) as NodeListener[]) {
			if (!previousListeners.includes(listener)) process.off(signal, listener);
		}
	}
}

function parseOutputLines(): Array<Record<string, unknown>> {
	return rpcIo.outputLines
		.flatMap((line) => line.split("\n"))
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function createRuntimeHost(harness: Harness): AgentSessionRuntime {
	return {
		session: harness.session,
		newSession: vi.fn(async () => ({ cancelled: true })),
		switchSession: vi.fn(async () => ({ cancelled: true })),
		fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
		dispose: vi.fn(async () => {}),
		setRebindSession: vi.fn(),
	} as unknown as AgentSessionRuntime;
}

async function startRpcHarness(extension: (pi: ExtensionAPI) => void): Promise<{
	harness: Harness;
	send(command: Record<string, unknown>): void;
	cleanup(): void;
}> {
	const listenerSnapshot = takeListenerSnapshot();
	const harness = await createHarness({ extensionFactories: [extension] });
	const cleanup = () => {
		harness.cleanup();
		restoreListeners(listenerSnapshot);
	};

	try {
		void runRpcMode(createRuntimeHost(harness));
		await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());
	} catch (error) {
		cleanup();
		throw error;
	}

	return {
		harness,
		send(command) {
			if (!rpcIo.lineHandler) throw new Error("RPC line handler is not attached");
			rpcIo.lineHandler(JSON.stringify(command));
		},
		cleanup,
	};
}

type InteractiveBashContext = {
	defaultEditor: { onSubmit?: (text: string) => Promise<void> | void };
	editor: { addToHistory?: (text: string) => void };
	facade: {
		isStreaming: boolean;
		isBashRunning: boolean;
		executeBash: (
			command: string,
			onChunk?: (chunk: string) => void,
			options?: { excludeFromContext?: boolean },
		) => Promise<
			| {
					output: string;
					exitCode: number;
					cancelled: boolean;
					truncated: boolean;
			  }
			| undefined
		>;
	};
	ui: { requestRender(): void };
	chatContainer: { addChild(component: unknown): void };
	pendingMessagesContainer: { addChild(component: unknown): void };
	pendingBashComponents: unknown[];
	outputPad: number;
	isBashMode: boolean;
	handleBashCommand(command: string, excludeFromContext?: boolean): Promise<void>;
	findClientExtensionCommand(text: string): undefined;
	setEmptySessionScreen(active: boolean): void;
	showError(message: string): void;
	updateEditorBorderColor(): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as {
	setupEditorSubmitHandler(this: InteractiveBashContext): void;
	handleBashCommand(this: InteractiveBashContext, command: string, excludeFromContext?: boolean): Promise<void>;
};

const localResult = {
	output: "local output",
	exitCode: 0,
	cancelled: false,
	truncated: false,
};

const rpcCases: Array<{
	name: string;
	extension: (pi: ExtensionAPI) => void;
	error?: string;
	executeCount: number;
}> = [
	{
		name: "fails the request without executing bash when a handler throws",
		extension: (pi) => {
			pi.on("user_bash", async () => {
				throw new Error("Routing failed");
			});
		},
		error: "Routing failed",
		executeCount: 0,
	},
	{
		name: "fails the request without executing bash when a handler returns an empty result",
		extension: (pi) => {
			pi.on("user_bash", async () => ({}) as unknown as UserBashEventResult);
		},
		error: "Invalid user_bash handler result",
		executeCount: 0,
	},
	{
		name: "executes bash normally when a handler returns undefined",
		extension: (pi) => {
			pi.on("user_bash", async () => undefined);
		},
		executeCount: 1,
	},
];

afterEach(() => {
	rpcIo.outputLines = [];
	rpcIo.lineHandler = undefined;
});

describe("RPC user_bash failure handling (#9068)", () => {
	test.each(rpcCases)("$name", async ({ extension, error, executeCount }) => {
		const rpc = await startRpcHarness(extension);
		const executeBash = vi.spyOn(rpc.harness.session, "executeBash").mockResolvedValue(localResult);

		try {
			rpc.send({ id: "bash-request", type: "bash", command: "pwd" });

			await vi.waitFor(() => {
				const response = parseOutputLines().find(
					(output) => output.type === "response" && output.id === "bash-request",
				);
				expect(response).toMatchObject({
					id: "bash-request",
					type: "response",
					command: "bash",
					success: error === undefined,
					...(error ? { error: expect.stringContaining(error) } : { data: localResult }),
				});
			});

			if (error) {
				expect(parseOutputLines()).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							type: "extension_error",
							event: "user_bash",
							error: expect.stringContaining(error),
						}),
					]),
				);
			}
			expect(executeBash).toHaveBeenCalledTimes(executeCount);
		} finally {
			executeBash.mockRestore();
			rpc.cleanup();
		}
	});
});

describe("Interactive user_bash delegation (#9068)", () => {
	test.each([
		["!pwd", false],
		["!!pwd", true],
	])("sends %s to the session, which runs the user_bash handler", async (input, excludeFromContext) => {
		const executeBash = vi.fn(async () => localResult);
		const context: InteractiveBashContext = {
			defaultEditor: {},
			editor: { addToHistory: vi.fn() },
			facade: { isStreaming: false, isBashRunning: false, executeBash },
			ui: { requestRender: vi.fn() },
			chatContainer: { addChild: vi.fn() },
			pendingMessagesContainer: { addChild: vi.fn() },
			pendingBashComponents: [],
			outputPad: 1,
			isBashMode: true,
			handleBashCommand: interactiveModePrototype.handleBashCommand,
			setEmptySessionScreen: vi.fn(),
			showError: vi.fn(),
			updateEditorBorderColor: vi.fn(),
			findClientExtensionCommand: () => undefined,
		};
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.(input);

		// The user_bash extension handler runs in the server's process, so the client only
		// forwards the command; the server fails the request closed when the handler misbehaves.
		expect(executeBash).toHaveBeenCalledWith("pwd", undefined, { excludeFromContext });
	});
});
