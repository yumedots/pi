import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("extension side", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-extension-side-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	async function load(factory: ExtensionFactory) {
		const runtime = createExtensionRuntime();
		return loadExtensionFromFactory(factory, tempDir, createEventBus(), runtime);
	}

	it("reports the declared side", async () => {
		const client = await load((pi) => {
			pi.setSide("client");
		});
		const server = await load((pi) => {
			pi.setSide("server");
		});
		const both = await load((pi) => {
			pi.setSide("both");
		});

		expect(client.side).toBe("client");
		expect(server.side).toBe("server");
		expect(both.side).toBe("both");
	});

	it("defaults to the server side", async () => {
		const extension = await load(() => {});

		expect(extension.side).toBe("server");
	});

	it("filters the loaded extensions by side", async () => {
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			extensionFactories: [
				(pi) => {
					pi.setSide("client");
				},
				(pi) => {
					pi.setSide("server");
				},
				(pi) => {
					pi.setSide("both");
				},
			],
		});
		await loader.reload();

		const clientPaths = loader.getExtensionsBySide("client").map((extension) => extension.side);
		const serverPaths = loader.getExtensionsBySide("server").map((extension) => extension.side);

		expect(clientPaths.sort()).toEqual(["both", "client"]);
		expect(serverPaths.sort()).toEqual(["both", "server"]);
	});

	it("skips client-only extensions on the server side and reports them", async () => {
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			extensionFactories: [
				(pi) => {
					pi.setSide("client");
				},
				(pi) => {
					pi.setSide("both");
				},
			],
		});
		await loader.reload();

		const loaded = loader.getExtensions().extensions;
		expect(loaded.map((extension) => extension.side)).toEqual(["both"]);
		expect(loader.getExtensions().warnings?.some((warning) => warning.warning.includes('side "client"'))).toBe(true);
	});

	it("keeps client-only extensions on the client side", async () => {
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			extensionSide: "client",
			extensionFactories: [
				(pi) => {
					pi.setSide("client");
				},
				(pi) => {
					pi.setSide("server");
				},
			],
		});
		await loader.reload();

		expect(loader.getExtensions().extensions.map((extension) => extension.side)).toEqual(["client"]);
	});
});
