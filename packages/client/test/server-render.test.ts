import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { PiServerClient, RenderRequest, RenderResponse } from "@earendil-works/pi-server/client";
import { stripAnsi } from "@earendil-works/pi-support/ansi";
import { Text, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { setThemeFromJson } from "../src/client-theme.ts";
import { CustomMessageComponent } from "../src/components/custom-message.ts";
import { ToolExecutionComponent } from "../src/components/tool-execution.ts";
import { RemoteSessionFacade } from "../src/remote-facade.ts";
import { setServerRenderProvider } from "../src/session-facade.ts";

/** A TUI that only records the redraw requests. */
function fakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

beforeAll(() => {
	const document = JSON.parse(
		readFileSync(join(import.meta.dirname, "../../coding-agent/src/core/theme/dark.json"), "utf-8"),
	) as unknown;
	setThemeFromJson(document);
});

afterEach(() => {
	setServerRenderProvider(undefined);
});

describe("the server renders what only it can render", () => {
	test("the facade asks the server and returns the answer", async () => {
		const requests: Array<{ sessionId: string; request: RenderRequest }> = [];
		const client = {
			events: () => () => {},
			render: async (sessionId: string, request: RenderRequest) => {
				requests.push({ sessionId, request });
				return { lines: ["the server drew this"] };
			},
		};
		const agentDir = mkdtempSync(join(tmpdir(), "pi-render-"));
		const facade = new RemoteSessionFacade(client as unknown as PiServerClient, "session-1", "/tmp/project", {
			agentDir,
		});
		const request: RenderRequest = { kind: "tool", toolName: "custom_tool", args: { path: "notes.txt" } };

		const response = await facade.render(request);

		expect(response).toEqual({ lines: ["the server drew this"] });
		expect(requests).toEqual([{ sessionId: "session-1", request }]);
		facade.dispose();
		rmSync(agentDir, { recursive: true, force: true });
	});

	test("a tool without a client renderer is drawn by the server", async () => {
		const requests: RenderRequest[] = [];
		const gate = Promise.withResolvers<RenderResponse>();
		setServerRenderProvider({
			render: (request) => {
				requests.push(request);
				return gate.promise;
			},
		});

		const component = new ToolExecutionComponent(
			"custom_tool",
			"call-1",
			{ path: "notes.txt" },
			{},
			undefined,
			fakeTui(),
			"/tmp/project",
		);

		// The row draws right away, with the client's own rendering.
		expect(stripAnsi(component.render(80).join("\n"))).toContain("custom_tool");

		gate.resolve({ lines: ["server tool row"] });
		await gate.promise;

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ kind: "tool", toolName: "custom_tool", toolCallId: "call-1" });
		expect(stripAnsi(component.render(80).join("\n"))).toContain("server tool row");
	});

	test("a tool with a client renderer stays with the client", async () => {
		let asked = 0;
		setServerRenderProvider({
			render: async () => {
				asked++;
				return { lines: ["server tool row"] };
			},
		});
		const definition = {
			name: "custom_tool",
			renderCall: () => new Text("client tool row", 0, 0),
		} as unknown as ToolDefinition;

		const component = new ToolExecutionComponent(
			"custom_tool",
			"call-1",
			{ path: "notes.txt" },
			{},
			definition,
			fakeTui(),
			"/tmp/project",
		);

		await Promise.resolve();

		expect(asked).toBe(0);
		expect(stripAnsi(component.render(80).join("\n"))).toContain("client tool row");
	});

	test("a custom message without a client renderer is drawn by the server", async () => {
		const requests: RenderRequest[] = [];
		const gate = Promise.withResolvers<RenderResponse>();
		setServerRenderProvider({
			render: (request) => {
				requests.push(request);
				return gate.promise;
			},
		});

		const component = new CustomMessageComponent({
			role: "custom",
			customType: "server_type",
			content: "hello",
			display: true,
			timestamp: 0,
		});

		expect(stripAnsi(component.render(80).join("\n"))).toContain("server_type");

		gate.resolve({ lines: ["server message row"] });
		await gate.promise;

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ kind: "message", customType: "server_type" });
		expect(stripAnsi(component.render(80).join("\n"))).toContain("server message row");
	});
});
