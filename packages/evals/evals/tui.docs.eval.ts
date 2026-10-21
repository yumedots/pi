import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { InteractiveMode, RemoteSessionFacade } from "@earendil-works/pi-client";
import {
	type AgentSession,
	type AgentSessionServices,
	type CreateAgentSessionResult,
	SessionManager,
	SettingsManager,
	createAgentSessionFromServices,
} from "@earendil-works/pi-coding-agent";
import { type PiServer, SessionRegistry, startServer } from "@earendil-works/pi-server";
import { PiServerClient } from "@earendil-works/pi-server/client";
import type { ProgramStatus } from "@earendil-works/pi-tui";
import { Levenshtein } from "autoevals";
import { createJudge, describeEval } from "vitest-evals";
import { createPiDocumentationEvalHarness, type PiCodingAgentInput } from "../src/harness.ts";

const CONTEXT_WINDOW = 272_000;
const BUILT_IN_CONTEXT_PATTERN = /\d+(?:\.\d+)?%\/272k(?: \(auto\))?/;
const CONTEXT_FIXTURES = [
	{ percent: 42.2, expectedBar: "████░░░░░░ 42%" },
	{ percent: 65, expectedBar: "███████░░░ 65%" },
	{ percent: 120, expectedBar: "██████████ 100%" },
] as const;

class RecordingTerminal {
	readonly columns = 100;
	readonly rows = 30;
	readonly kittyProtocolActive = true;
	private writes: string[] = [];
	private resizeHandler?: () => void;

	start(_onInput: (data: string) => void, onResize: () => void): void {
		this.resizeHandler = onResize;
	}

	stop(): void {
		this.resizeHandler = undefined;
	}

	async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}

	write(data: string): void {
		this.writes.push(data);
	}

	moveBy(_lines: number): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(_title: string): void {}
	setProgress(_active: boolean): void {}
	setProgramStatus(_status: ProgramStatus): void {}

	requestResize(): void {
		this.resizeHandler?.();
	}

	async takeRenders(): Promise<string[]> {
		await setTimeout(30);
		const output = this.writes.join("");
		this.writes = [];
		const startMarker = "\x1b[?2026h";
		const endMarker = "\x1b[?2026l";
		const renders: string[] = [];
		let offset = 0;
		while (true) {
			const start = output.indexOf(startMarker, offset);
			if (start === -1) return renders;
			const contentStart = start + startMarker.length;
			const end = output.indexOf(endMarker, contentStart);
			if (end === -1) throw new Error("TUI emitted an incomplete synchronized render.");
			renders.push(stripVTControlCharacters(output.slice(contentStart, end)));
			offset = end + endMarker.length;
		}
	}
}

type TuiFooterOutput = {
	builtInStatusLine: string | null;
	observations: Array<{
		percent: number;
		renderedOutput: string;
		contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | null;
	}>;
	extensionErrors: string[];
};

function lines(output: string): string[] {
	return output.split(/[\r\n]+/).filter((line) => line.trim().length > 0);
}

function createContextMessage(model: NonNullable<AgentSession["model"]>, percent: number): AssistantMessage {
	const tokens = Math.round((model.contextWindow * percent) / 100);
	return {
		role: "assistant",
		content: [{ type: "text", text: "Context usage fixture" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: tokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: tokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/**
 * The oracle session and the server that hosts it.
 *
 * The terminal UI never hosts the agent runtime any more: it drives the session through
 * the facade of a server. The oracle therefore runs in an embedded server, and the client
 * reaches it over HTTP and SSE.
 */
interface EmbeddedOracle {
	server: PiServer;
	sessionId: string;
	agentDir: string;
}

async function startEmbeddedOracle(
	cwd: string,
	services: AgentSessionServices,
	oracle: CreateAgentSessionResult,
): Promise<EmbeddedOracle> {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-tui-footer-eval-"));
	const settingsManager = SettingsManager.create(cwd, agentDir);
	// The server never prompts, so the oracle project has to be trusted up front.
	settingsManager.setDefaultProjectTrust("always");
	const registry = new SessionRegistry({
		agentDir,
		settingsManager,
		createRuntime: async () => ({
			session: oracle.session,
			services,
			extensionsResult: oracle.extensionsResult,
			diagnostics: [],
		}),
	});
	const server = await startServer({
		port: 0,
		agentDir,
		cwd,
		password: "pi-tui-footer-eval",
		registry,
	});
	const serverSession = await registry.create(cwd);
	return { server, sessionId: serverSession.id, agentDir };
}

async function inspectContextFooter(session: AgentSession, agentDir: string): Promise<TuiFooterOutput> {
	const activeModel = session.model;
	if (!activeModel) throw new Error("TUI footer oracle requires an active model.");
	const model = { ...activeModel, contextWindow: CONTEXT_WINDOW };
	const services: AgentSessionServices = {
		cwd: session.sessionManager.getCwd(),
		agentDir,
		modelRuntime: session.modelRuntime,
		settingsManager: session.settingsManager,
		resourceLoader: session.resourceLoader,
		diagnostics: [],
	};
	const oracle = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(services.cwd),
		model,
		thinkingLevel: "high",
		noTools: "all",
	});
	const oracleSession = oracle.session;
	const previousOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	const embedded = await startEmbeddedOracle(services.cwd, services, oracle);
	try {
		oracleSession.sessionManager.appendMessage({
			...createContextMessage(model, 0),
			usage: {
				input: 106_000,
				output: 5_800,
				cacheRead: 606_000,
				cacheWrite: 0,
				totalTokens: 717_800,
				cost: { input: 1.008, output: 0, cacheRead: 0, cacheWrite: 0, total: 1.008 },
			},
		});
		const client = new PiServerClient({ url: embedded.server.url, password: embedded.server.password });
		const facade = new RemoteSessionFacade(client, embedded.sessionId, services.cwd, {
			agentDir,
			modelRuntime: session.modelRuntime,
		});
		await facade.load();
		const terminal = new RecordingTerminal();
		const mode = new InteractiveMode(facade, { tuiMode: "regular", terminal });
		try {
			let builtInStatusLine: string | null = null;
			const observations: TuiFooterOutput["observations"] = [];
			for (const [index, { percent }] of CONTEXT_FIXTURES.entries()) {
				const fixture = createContextMessage(model, percent);
				oracleSession.agent.state.messages = [fixture];
				// The context usage of a session comes from its entries, so the fixture has
				// to be part of the transcript for the server to report its percentage.
				oracleSession.sessionManager.appendMessage(fixture);
				if (index === 0) {
					await mode.init();
				} else {
					// The footer reads the context usage of the server, so the client has to
					// pick up the new snapshot before the next frame is rendered.
					await facade.load();
					terminal.requestResize();
				}
				const renders = await terminal.takeRenders();
				if (index === 0) {
					builtInStatusLine = renders.flatMap(lines).find((line) => BUILT_IN_CONTEXT_PATTERN.test(line)) ?? null;
				}
				observations.push({
					percent,
					renderedOutput: renders.at(-1) ?? "",
					contextUsage: facade.contextUsage ?? null,
				});
			}
			return {
				builtInStatusLine,
				observations,
				extensionErrors: session.resourceLoader.getExtensions().errors.map(({ error }) => error),
			};
		} finally {
			mode.stop("resume-hint");
			facade.dispose();
		}
	} finally {
		try {
			await embedded.server.close();
		} finally {
			await rm(embedded.agentDir, { recursive: true, force: true });
			if (previousOffline === undefined) delete process.env.PI_OFFLINE;
			else process.env.PI_OFFLINE = previousOffline;
		}
	}
}

const harness = createPiDocumentationEvalHarness({
	output: ({ session, agentDir }) => inspectContextFooter(session, agentDir),
});

const contextFooterJudge = createJudge<PiCodingAgentInput, TuiFooterOutput>(
	"ContextFooterJudge",
	async ({ output }) => {
		let valid = output.extensionErrors.length === 0;
		const similarities: number[] = [];
		const contextMarker = "{context}";
		const builtInStatusLine = output.builtInStatusLine?.trim().replace(/\s+/g, " ");
		const reference = builtInStatusLine?.replace(BUILT_IN_CONTEXT_PATTERN, contextMarker);
		if (!reference?.includes(contextMarker)) valid = false;
		for (const [index, { percent, expectedBar }] of CONTEXT_FIXTURES.entries()) {
			const observation = output.observations[index];
			if (!observation || observation.percent !== percent) {
				valid = false;
				continue;
			}
			if (
				observation.contextUsage?.contextWindow !== CONTEXT_WINDOW ||
				Math.round((observation.contextUsage?.percent ?? -1) * 10) / 10 !== percent
			) {
				valid = false;
			}
			const actualStatusLine = lines(observation.renderedOutput).find(
				(line) => line.includes(expectedBar) || BUILT_IN_CONTEXT_PATTERN.test(line),
			);
			if (!actualStatusLine) {
				valid = false;
				continue;
			}
			const normalizedStatusLine = actualStatusLine.trim().replace(/\s+/g, " ");
			if (!normalizedStatusLine.includes(expectedBar) || BUILT_IN_CONTEXT_PATTERN.test(normalizedStatusLine)) {
				valid = false;
				continue;
			}
			for (const { expectedBar: otherBar } of CONTEXT_FIXTURES) {
				if (otherBar !== expectedBar && normalizedStatusLine.includes(otherBar)) valid = false;
			}
			if (reference) {
				const result = await Levenshtein({
					expected: reference,
					output: normalizedStatusLine.replace(expectedBar, contextMarker),
				});
				if (result.score !== null) similarities.push(result.score);
			}
		}
		const retained = similarities.length === CONTEXT_FIXTURES.length ? Math.min(...similarities) : 0;
		return {
			score: valid ? 1 : 0,
			metadata: {
				rationale: valid
					? `Footer retained ${Math.round(retained * 100)}% of the built-in status text.`
					: "Context progress behavior was incorrect.",
				retainedPercent: Math.round(retained * 100),
			},
		};
	},
);

describeEval(
	"Customize the interactive context footer",
	{ harness, judges: [contextFooterJudge], judgeThreshold: null },
	(it) => {
		it("replaces numeric context usage with a progress bar", async ({ run }) => {
			await run([
				{
					type: "prompt",
					content:
						"Change the Pi footer replacing the built-in context info, e.g. `42.2%/272k (auto)`, with a ten-cell progress bar to make it show ████░░░░░░ 42% instead. Clamp percentages to the 0-100 range. Just replace the context. Otherwise leave everything else the same.",
				},
				{ type: "reload" },
			]);
		});
	},
);
