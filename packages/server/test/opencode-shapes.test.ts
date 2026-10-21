import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import { type SessionSummary, toMessageInfo, toSessionInfo, usageTotals } from "../src/routes/opencode-shapes.ts";

/** The committed opencode OpenAPI schema. */
const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/opencode-openapi.json", import.meta.url));

/** The schemas of the openapi fixture. */
const schemas = (
	JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
		components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
	}
).components.schemas;

/**
 * The property names of a schema of the fixture.
 */
function propertiesOf(name: string): string[] {
	const schema = schemas[name];
	expect(schema, `the fixture has no schema ${name}`).toBeDefined();
	return Object.keys(schema?.properties ?? {});
}

/**
 * A session summary, as the registry reports it.
 */
function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: "session-1",
		path: "/tmp/pi-agent/sessions/project-abc/session-1.jsonl",
		cwd: "/tmp/project",
		name: undefined,
		created: 1000,
		modified: 2000,
		messageCount: 2,
		firstMessage: "hello",
		busy: false,
		...overrides,
	};
}

describe("the opencode wire shapes", () => {
	test("the session info carries the properties the opencode schema declares", () => {
		const fixtureProperties = propertiesOf("Session.Info");
		for (const property of ["id", "projectID", "cost", "tokens", "time", "location"]) {
			expect(fixtureProperties).toContain(property);
		}
		const info = toSessionInfo(summary());
		for (const property of ["id", "projectID", "cost", "tokens", "time", "location"]) {
			expect(Object.keys(info)).toContain(property);
		}
		for (const property of Object.keys(info)) {
			expect(fixtureProperties).toContain(property);
		}
	});

	test("the session info maps the project, the model and the title", () => {
		const info = toSessionInfo(summary({ name: "the session" }));
		expect(info.id).toBe("session-1");
		expect(info.projectID).toBe("project-abc");
		expect(info.agent).toBe("build");
		expect(info.title).toBe("the session");
		expect(info.location).toEqual({ directory: "/tmp/project" });
	});

	test("the session title falls back to the first user message", () => {
		expect(toSessionInfo(summary()).title).toBe("hello");
	});

	test("a busy session is interrupted and an idle one succeeded", () => {
		expect(toSessionInfo(summary({ busy: true })).outcome).toBe("interrupted");
		expect(toSessionInfo(summary({ busy: false })).outcome).toBe("succeeded");
	});

	test("the user message carries the properties the opencode schema declares", () => {
		const fixtureProperties = propertiesOf("Session.Message.User");
		const message: AgentMessage = { role: "user", content: "hello", timestamp: 1000 };
		const info = toMessageInfo(message, "message-1", 1000);
		expect(info.type).toBe("user");
		expect(info.text).toBe("hello");
		expect(info.time).toEqual({ created: 1000 });
		for (const property of ["id", "time", "text", "type"]) {
			expect(fixtureProperties).toContain(property);
			expect(Object.keys(info)).toContain(property);
		}
	});

	test("the assistant message carries the properties the opencode schema declares", () => {
		const fixtureProperties = propertiesOf("Session.Message.Assistant");
		const message: AgentMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4",
			usage: {
				input: 10,
				output: 20,
				cacheRead: 5,
				cacheWrite: 1,
				totalTokens: 36,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 },
			},
			stopReason: "stop",
			timestamp: 2000,
		};
		const info = toMessageInfo(message, "message-2", 2000);
		expect(info.type).toBe("assistant");
		expect(info.agent).toBe("build");
		expect(info.model).toEqual({ id: "claude-sonnet-4", providerID: "anthropic" });
		expect(info.content).toEqual([{ type: "text", text: "hi" }]);
		expect(info.finish).toBe("stop");
		expect(info.cost).toBe(0.25);
		expect(info.tokens).toEqual({
			input: 10,
			output: 20,
			reasoning: 0,
			cache: { read: 5, write: 1 },
		});
		for (const property of ["id", "time", "type", "agent", "model", "content", "finish", "cost", "tokens"]) {
			expect(fixtureProperties).toContain(property);
			expect(Object.keys(info)).toContain(property);
		}
	});

	test("the usage totals sum the usage entries", () => {
		const entries = [
			{
				type: "usage",
				usage: {
					input: 10,
					output: 20,
					reasoning: 5,
					cacheRead: 3,
					cacheWrite: 2,
					totalTokens: 40,
					cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
				},
			},
			{
				type: "usage",
				usage: {
					input: 1,
					output: 2,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 3,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.05 },
				},
			},
		] as unknown as Parameters<typeof usageTotals>[0];
		const totals = usageTotals(entries);
		expect(totals.cost).toBeCloseTo(0.35, 10);
		expect(totals.tokens).toEqual({
			input: 11,
			output: 22,
			reasoning: 5,
			cache: { read: 3, write: 2 },
		});
	});

	test("the model info carries the properties the opencode schema declares", () => {
		const fixtureProperties = propertiesOf("Model.Info");
		for (const property of ["id", "modelID", "providerID", "name", "cost", "limit", "capabilities"]) {
			expect(fixtureProperties).toContain(property);
		}
	});
});
