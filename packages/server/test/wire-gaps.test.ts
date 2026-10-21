/**
 * The wire shapes the client needs and the protocol did not carry.
 *
 * The tree navigation reports more than "cancelled", and the session publishes the tools
 * it declares to the model. Both travel over the same channels as the rest of the pi
 * protocol, so the tests here drive the real controller and the real route.
 */

import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentSession,
	AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionController,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test } from "vitest";
import { Router } from "../src/http/router.ts";
import { registerPiRoutes } from "../src/routes/pi.ts";
import type { ServerContext } from "../src/server-context.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function createController(): Promise<SessionController> {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-wire-gaps-agent-"));
	tempDirs.push(agentDir);
	const cwd = mkdtempSync(join(tmpdir(), "pi-wire-gaps-cwd-"));
	tempDirs.push(cwd);

	const sessionManager = SessionManager.inMemory(cwd);
	const services = await createAgentSessionServices({ cwd, agentDir });
	const created = await createAgentSessionFromServices({ services, sessionManager });
	const runtime = new AgentSessionRuntime(created.session, services, (async () => ({
		...created,
		services,
	})) as unknown as CreateAgentSessionRuntimeFactory);
	const controller = new SessionController(runtime, {
		onEvent: () => {},
		requestExtensionUi: async (request) => ({ type: "extension_ui_response", id: request.id, cancelled: true }),
	});
	await controller.rebind();
	return controller;
}

/** The result of the tree navigation, as the client reads it. */
interface NavigateTreeData {
	cancelled: boolean;
	aborted?: boolean;
	editorText?: string;
}

/** The tools the resources snapshot publishes. */
interface PublishedTool {
	name?: string;
	description?: string;
	parameters?: unknown;
}

/** The body of the resources snapshot. */
interface ResourcesBody {
	data: {
		tools?: PublishedTool[];
		extensions?: Array<{ path?: string; side?: string }>;
	};
}

/** A response that records what the route wrote. */
class FakeResponse {
	status = 0;
	payload = "";

	writeHead(status: number): this {
		this.status = status;
		return this;
	}

	end(payload?: string): this {
		this.payload = payload ?? "";
		return this;
	}
}

/** Ask the resources route for the resources of a session. */
async function readResources(session: AgentSession): Promise<{ status: number; body: ResourcesBody }> {
	const router = new Router();
	const context = {
		registry: {
			get: (id: string) => (id === "session-1" ? { id, runtime: { session } } : undefined),
		},
	} as unknown as ServerContext;
	registerPiRoutes(router, context);

	const res = new FakeResponse();
	const req = { url: "/pi/session/session-1/resources", method: "GET" } as unknown as IncomingMessage;
	const handled = await router.handle(req, res as unknown as ServerResponse);
	expect(handled).toBe(true);
	return { status: res.status, body: JSON.parse(res.payload) as ResourcesBody };
}

describe("the tree navigation over the wire", () => {
	test("carries the text the editor takes back", async () => {
		const controller = await createController();
		const sessionManager = controller.session.sessionManager;
		const first = sessionManager.appendMessage({ role: "user", content: "first", timestamp: Date.now() });
		sessionManager.appendMessage({ role: "user", content: "second", timestamp: Date.now() });

		const response = await controller.handle({ id: "tree-1", type: "navigate_tree", targetId: first });
		expect(response).toMatchObject({
			id: "tree-1",
			type: "response",
			command: "navigate_tree",
			success: true,
		});
		const data = response?.success && "data" in response ? (response.data as NavigateTreeData) : undefined;
		expect(data).toMatchObject({ cancelled: false, editorText: "first" });
		expect(data?.aborted).toBeUndefined();
	});

	test("reports the cancellation of the navigation", async () => {
		const controller = await createController();
		const entryId = controller.session.sessionManager.appendMessage({
			role: "user",
			content: "only",
			timestamp: Date.now(),
		});
		const response = await controller.handle({ type: "navigate_tree", targetId: entryId });
		const data = response?.success && "data" in response ? (response.data as NavigateTreeData) : undefined;
		expect(data?.cancelled).toBe(false);
	});
});

describe("the published tools of a session", () => {
	test("names the tools the session declares to the model", async () => {
		const controller = await createController();
		const { status, body } = await readResources(controller.session);
		expect(status).toBe(200);

		const tools = body.data.tools ?? [];
		expect(tools.length).toBeGreaterThan(0);
		expect(tools.map((tool) => tool.name)).toEqual(controller.session.agent.state.tools.map((tool) => tool.name));
		expect(tools.map((tool) => tool.name)).toContain("read");
		for (const tool of tools) {
			expect(typeof tool.name).toBe("string");
		}
	});

	test("publishes the schema of a tool", async () => {
		const controller = await createController();
		const { body } = await readResources(controller.session);
		const read = (body.data.tools ?? []).find((tool) => tool.name === "read");
		expect(read).toBeDefined();
		expect(typeof read?.description).toBe("string");
		expect(typeof read?.parameters).toBe("object");
	});
});
