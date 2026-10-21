import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { ReadonlyFooterDataProvider } from "../../coding-agent/src/core/footer-data-provider.ts";
import { initTheme } from "../../coding-agent/src/core/theme/theme.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import { FooterComponent, formatContextBar, formatCwdForFooter } from "../src/components/footer.ts";
import type { SessionFacade } from "../src/session-facade.ts";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	modelId?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
	branchUsage?: AssistantUsage;
	compactionUsage?: AssistantUsage;
	toolUsage?: AssistantUsage;
	usingSubscription?: boolean;
	routedModel?: { model: { id: string }; thinkingLevel?: string };
	contextUsage?: { contextWindow: number; percent: number | null; tokens: number | null };
}): SessionFacade {
	const usage = options.usage;
	const entries: Array<Record<string, unknown>> = [];

	if (usage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "assistant",
				usage,
			},
		});
	}

	if (options.branchUsage !== undefined) {
		entries.push({
			type: "branch_summary",
			usage: options.branchUsage,
		});
	}

	if (options.compactionUsage !== undefined) {
		entries.push({
			type: "compaction",
			usage: options.compactionUsage,
		});
	}

	if (options.toolUsage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "toolResult",
				usage: options.toolUsage,
			},
		});
	}

	const model = {
		id: options.modelId ?? "test-model",
		provider: options.provider ?? "test",
		contextWindow: 200_000,
		reasoning: options.reasoning ?? false,
	};
	const session = {
		state: {
			model,
			thinkingLevel: options.thinkingLevel ?? "off",
			isStreaming: false,
			messages: [],
			systemPrompt: "",
		},
		model,
		thinkingLevel: options.thinkingLevel ?? "off",
		contextUsage: options.contextUsage ?? { contextWindow: 200_000, percent: 12.3, tokens: 24_600 },
		sessionManager: {
			getEntries: () => entries,
			getSessionId: () => "test-session",
			getLeafId: () => null,
			getSessionName: () => options.sessionName,
			getCwd: () => "/tmp/project",
		},
		modelRuntime: {
			isUsingSubscription: () => options.usingSubscription ?? false,
		},
	};

	return session as unknown as SessionFacade;
}

function createFooterData(providerCount: number): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

describe("formatContextBar", () => {
	it("fills the bar by the percentage", () => {
		expect(formatContextBar(0, 10)).toBe("\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591");
		expect(formatContextBar(50, 10)).toBe("\u2588\u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591\u2591");
		expect(formatContextBar(100, 10)).toBe("\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588");
	});

	it("clamps the percentage to the bar", () => {
		expect(formatContextBar(-10, 10)).toBe("\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591");
		expect(formatContextBar(150, 10)).toBe("\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588");
	});
});

describe("FooterComponent width handling", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("keeps stats line within width for wide model and provider names", () => {
		const width = 60;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(30),
			provider: "공급자",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("puts the model, the stats, and the path on one line", () => {
		const session = createSession({
			sessionName: "",
			modelId: "glm-5.1",
			reasoning: true,
			thinkingLevel: "medium",
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(120);
		expect(lines).toHaveLength(1);
		const line = stripAnsi(lines[0]);
		expect(line).toContain(`test/glm-5.1 / medium / ${formatContextBar(12.3)} 12.3% 24,600 tokens`);
		expect(line).toContain("/tmp/project:main");
		expect(line.indexOf("glm-5.1")).toBeLessThan(line.indexOf("/tmp/project:main"));
	});

	it("puts the provider in front of the model name", () => {
		const session = createSession({
			sessionName: "",
			modelId: "glm-5.1",
			provider: "zhipu",
			reasoning: true,
			thinkingLevel: "medium",
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const line = stripAnsi(footer.render(120)[0]);
		expect(line).toContain("zhipu/glm-5.1 / medium");
	});

	it("shows Nerd Font glyphs in front of the footer groups", () => {
		const session = createSession({
			sessionName: "",
			modelId: "glm-5.1",
			reasoning: true,
			thinkingLevel: "medium",
		});
		const footer = new FooterComponent(session, createFooterData(1));
		footer.setNerdFonts(true);

		const line = stripAnsi(footer.render(120)[0]);
		expect(line).toContain("\uF2DB test/glm-5.1");
		expect(line).toContain("\uF0E7 medium");
		expect(line).toContain(`\uF200 ${formatContextBar(12.3)} 12.3% 24,600 tokens`);
		expect(line).toContain("\uF07C /tmp/project");
		expect(line).toContain("\uF126 main");
		// The icons separate the groups, so the gap between them is wider.
		expect(line).toContain("\uF2DB test/glm-5.1  \uF0E7 medium");
		expect(visibleWidth(line)).toBeLessThanOrEqual(120);
	});

	it("keeps the footer plain without Nerd Font glyphs", () => {
		const session = createSession({
			sessionName: "",
			modelId: "glm-5.1",
			reasoning: true,
			thinkingLevel: "medium",
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const line = stripAnsi(footer.render(120)[0]);
		expect(line).not.toContain("\uF2DB");
		expect(line).toContain("test/glm-5.1 / medium");
	});

	it("keeps the context percentage and the model on a narrow line", () => {
		const session = createSession({
			sessionName: "",
			modelId: "glm-5.1",
			reasoning: true,
			thinkingLevel: "medium",
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const line = stripAnsi(footer.render(40)[0]);
		expect(visibleWidth(line)).toBeLessThanOrEqual(40);
		expect(line).toContain(`${formatContextBar(12.3)} 12.3% 24,600 tokens`);
		expect(line).toContain("glm-5.1");
	});

	it("drops the context meter while the used tokens are unknown", () => {
		const session = createSession({
			sessionName: "",
			modelId: "glm-5.1",
			contextUsage: { contextWindow: 200_000, percent: null, tokens: null },
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const line = stripAnsi(footer.render(120)[0]);
		expect(line).not.toContain("?");
		expect(line).not.toContain("░");
		expect(line).toContain("test/glm-5.1");
		expect(line).toContain("/tmp/project:main");
	});

	it("shows the cost on the right side of the line", () => {
		const session = createSession({
			sessionName: "",
			modelId: "glm-5.1",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const line = stripAnsi(footer.render(120)[0]);
		expect(line).toContain(`${formatContextBar(12.3)} 12.3% 24,600 tokens`);
		expect(line).toContain("/tmp/project:main • $1.234");
		expect(line).not.toContain("↑12k");
		expect(line).not.toContain("↓6.8k");
	});

	it("keeps the cost when the line is narrow", () => {
		const session = createSession({
			sessionName: "",
			modelId: "glm-5.1",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const line = stripAnsi(footer.render(50)[0]);
		expect(visibleWidth(line)).toBeLessThanOrEqual(50);
		expect(line).toContain("$1.234");
	});

	it("does not show a virtual model's routing target, which lives in the server", () => {
		const session = createSession({
			sessionName: "",
			modelId: "auto",
			reasoning: true,
			thinkingLevel: "high",
			routedModel: { model: { id: "gpt-5.6-luna" }, thinkingLevel: "medium" },
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[0]);

		expect(statsLine).toContain("auto / high");
		expect(statsLine).not.toContain("gpt-5.6-luna");
	});

	it("includes summary and tool result usage in the total cost", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.5 },
			},
			branchUsage: {
				input: 20,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.25 },
			},
			compactionUsage: {
				input: 5,
				output: 2,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.125 },
			},
			toolUsage: {
				input: 15,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.375 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[0]);
		expect(statsLine).toContain("$1.250");
	});

	it("updates cached usage totals after an entry is appended", () => {
		const usage = { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } };
		const session = createSession({ sessionName: "", usage });
		const footer = new FooterComponent(session, createFooterData(1));
		expect(stripAnsi(footer.render(120)[0])).toContain("$0.500");

		session.sessionManager.getEntries().push({ type: "message", message: { role: "assistant", usage } } as never);
		expect(stripAnsi(footer.render(120)[0])).toContain("$1.000");
	});

	it("marks Kimi Coding costs as subscription estimates", () => {
		const session = createSession({
			sessionName: "",
			provider: "kimi-coding",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120)[0])).toContain("$1.234 (sub)");
	});

	it("marks explicitly identified subscription auth", () => {
		const session = createSession({ sessionName: "", provider: "anthropic", usingSubscription: true });
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120)[0])).toContain("$0.000 (sub)");
	});

	it("does not mark generic OAuth sign-in as a subscription", () => {
		const session = createSession({
			sessionName: "",
			provider: "openrouter",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));
		const stats = stripAnsi(footer.render(120)[0]);

		expect(stats).toContain("$1.234");
		expect(stats).not.toContain("(sub)");
	});
});
