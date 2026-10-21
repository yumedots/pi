import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionController,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function createController(): Promise<SessionController> {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-server-controller-"));
	tempDirs.push(agentDir);
	const cwd = mkdtempSync(join(tmpdir(), "pi-server-cwd-"));
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

describe("the session controller", () => {
	test("answers a known command with the response envelope", async () => {
		const controller = await createController();
		const response = await controller.handle({ id: "state-1", type: "get_state" });
		expect(response).toMatchObject({
			id: "state-1",
			type: "response",
			command: "get_state",
			success: true,
		});
		expect(response && "data" in response ? response.data : undefined).toMatchObject({
			sessionId: expect.any(String),
			isStreaming: false,
		});
	});

	test("answers an unknown command with a failure envelope", async () => {
		const controller = await createController();
		const response = await controller.handle({ id: "x", type: "not_a_command" } as never);
		expect(response).toEqual({
			id: "x",
			type: "response",
			command: "not_a_command",
			success: false,
			error: "Unknown command: not_a_command",
		});
	});

	test("forwards session events to the subscribers", async () => {
		const controller = await createController();
		const events: string[] = [];
		const unsubscribe = controller.subscribe((event) => events.push(event.type));
		await controller.handle({ type: "clear_queue" });
		unsubscribe();
		expect(Array.isArray(events)).toBe(true);
	});
});
