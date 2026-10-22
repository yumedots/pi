import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAvailableThemes } from "@earendil-works/pi-coding-agent/core/theme/theme";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientExtensionRuntime } from "../src/client-extension-runtime.ts";
import { loadClientExtensions } from "../src/client-extensions.ts";

describe("client extensions", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-client-extensions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function writeExtension(name: string, source: string): void {
		const extensionsDir = join(cwd, ".pi", "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		writeFileSync(join(extensionsDir, `${name}.ts`), source);
	}

	async function loadRuntime(): Promise<ClientExtensionRuntime> {
		const load = await loadClientExtensions({ cwd, agentDir });
		return new ClientExtensionRuntime(load);
	}

	it("keeps the client and both extensions and drops the server ones", async () => {
		writeExtension(
			"client-extension",
			`export default function (pi) {
	pi.setSide("client");
	pi.registerMessageRenderer("client-message", () => undefined);
}`,
		);
		writeExtension(
			"server-extension",
			`export default function (pi) {
	pi.setSide("server");
}`,
		);
		writeExtension(
			"both-extension",
			`export default function (pi) {
	pi.setSide("both");
}`,
		);

		const runtime = await loadRuntime();

		expect(runtime.extensions.map((extension) => extension.side).sort()).toEqual(["both", "client"]);
		expect(runtime.skipped.map((extension) => extension.side)).toEqual(["server"]);
	});

	it("finds the message renderer of a client extension", async () => {
		writeExtension(
			"client-extension",
			`export default function (pi) {
	pi.setSide("client");
	pi.registerMessageRenderer("client-message", () => undefined);
}`,
		);

		const runtime = await loadRuntime();

		expect(runtime.getMessageRenderer("client-message")).toBeDefined();
		expect(runtime.getMessageRenderer("not-registered")).toBeUndefined();
	});

	it("makes the theme of an extension selectable", async () => {
		const extensionsDir = join(cwd, ".pi", "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		writeFileSync(
			join(extensionsDir, "themed-extension.ts"),
			`export default function (pi) {
	pi.setSide("client");
}`,
		);
		const baseTheme = JSON.parse(
			readFileSync(join(import.meta.dirname, "../../coding-agent/src/core/theme/dark.json"), "utf8"),
		) as { name: string };
		writeFileSync(join(extensionsDir, "theme.json"), JSON.stringify({ ...baseTheme, name: "client-theme" }));

		const runtime = await loadRuntime();

		expect(runtime.themes.map((theme) => theme.name)).toContain("client-theme");
		runtime.registerThemes();
		expect(getAvailableThemes()).toContain("client-theme");
	});

	it("reports a both extension the server does not have", async () => {
		writeExtension(
			"both-extension",
			`export default function (pi) {
	pi.setSide("both");
}`,
		);

		const runtime = await loadRuntime();
		const both = runtime.extensions.find((extension) => extension.side === "both");
		expect(both).toBeDefined();

		const withoutServer = runtime.getDiagnostics([]);
		expect(
			withoutServer.some(
				(diagnostic) =>
					diagnostic.type === "warning" && diagnostic.path === both?.path && diagnostic.message.includes("server"),
			),
		).toBe(true);

		const withServer = runtime.getDiagnostics([{ path: both?.path ?? "", side: "both" }]);
		expect(withServer.some((diagnostic) => diagnostic.path === both?.path)).toBe(false);
	});

	it("does not report the server-side extensions as issues", async () => {
		writeExtension(
			"server-extension",
			`export default function (pi) {
	pi.setSide("server");
}`,
		);
		writeExtension(
			"another-server-extension",
			`export default function (pi) {
	pi.setSide("server");
}`,
		);

		const runtime = await loadRuntime();
		expect(runtime.skipped.map((extension) => extension.side)).toEqual(["server", "server"]);

		const diagnostics = [...runtime.diagnostics, ...runtime.getDiagnostics([])];
		expect(diagnostics.filter((diagnostic) => (diagnostic.path ?? "").includes("server-extension"))).toEqual([]);
		expect(diagnostics.filter((diagnostic) => diagnostic.message.includes("skipped"))).toEqual([]);
	});

	it("reports a both extension the server does not have exactly once", async () => {
		writeExtension(
			"both-extension",
			`export default function (pi) {
	pi.setSide("both");
}`,
		);

		const runtime = await loadRuntime();
		const both = runtime.extensions.find((extension) => extension.side === "both");
		expect(both).toBeDefined();

		const diagnostics = [...runtime.diagnostics, ...runtime.getDiagnostics([])];
		const reported = diagnostics.filter((diagnostic) => diagnostic.path === both?.path);
		expect(reported).toHaveLength(1);
		expect(reported[0]?.message).toContain("server");
		expect(reported[0]?.message).toContain("installed on the server");
	});

	it("reports an extension that does not load", async () => {
		writeExtension(
			"broken-extension",
			`export default function (pi) {
	pi.setSide("client");
`,
		);

		const runtime = await loadRuntime();

		const diagnostics = [...runtime.diagnostics, ...runtime.getDiagnostics([])];
		const reported = diagnostics.filter((diagnostic) => (diagnostic.path ?? "").includes("broken-extension"));
		expect(reported.length).toBeGreaterThan(0);
		expect(reported.some((diagnostic) => diagnostic.type === "error")).toBe(true);
	});
});
