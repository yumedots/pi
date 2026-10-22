import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverClientExtensionFiles } from "../src/client-extensions.ts";
import { collectClientExtensions } from "../src/manifest-check.ts";

describe("the extensions the client has", () => {
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

	/**
	 * Write an extension into the extensions directory of an agent directory.
	 */
	function writeExtension(dir: string, name: string, source: string): string {
		const extensionsDir = join(dir, "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		const path = join(extensionsDir, `${name}.ts`);
		writeFileSync(path, source);
		return path;
	}

	/**
	 * Write an extension into the extensions directory of a project.
	 */
	function writeProjectExtension(name: string, source: string): string {
		const extensionsDir = join(cwd, ".pi", "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		const path = join(extensionsDir, `${name}.ts`);
		writeFileSync(path, source);
		return path;
	}

	it("finds the extensions of the project and of the agent directory", () => {
		const project = writeProjectExtension("project-extension", `export default function (pi) {}`);
		const global = writeExtension(agentDir, "global-extension", `export default function (pi) {}`);

		const files = discoverClientExtensionFiles({ cwd, agentDir });

		expect(files.map((file) => file.path).sort()).toEqual([global, project].sort());
	});

	it("finds the extensions of a directory with an index file", () => {
		const packageDir = join(cwd, ".pi", "extensions", "packaged");
		mkdirSync(packageDir, { recursive: true });
		const index = join(packageDir, "index.ts");
		writeFileSync(index, `export default function (pi) {}`);

		const files = discoverClientExtensionFiles({ cwd, agentDir });

		expect(files.map((file) => file.path)).toEqual([index]);
	});

	it("finds the extensions of the paths the settings name", () => {
		const elsewhere = join(tempDir, "elsewhere");
		mkdirSync(elsewhere, { recursive: true });
		const path = join(elsewhere, "configured-extension.ts");
		writeFileSync(path, `export default function (pi) {}`);

		const files = discoverClientExtensionFiles({ cwd, agentDir, configuredPaths: [elsewhere] });

		expect(files.map((file) => file.path)).toEqual([path]);
	});

	it("gives every extension the digest of its content", () => {
		const _path = writeProjectExtension("hashed-extension", `export default function (pi) {}`);

		const files = discoverClientExtensionFiles({ cwd, agentDir });

		expect(files[0]?.hash).toMatch(/^[0-9a-f]{12}$/);
	});

	it("does not load the extensions it finds", () => {
		writeProjectExtension("broken-extension", `export default function (pi) {`);

		expect(() => discoverClientExtensionFiles({ cwd, agentDir })).not.toThrow();
	});

	it("lists the extensions of the client the way the manifest compares them", () => {
		const path = writeProjectExtension("client-extension", `export default function (pi) {}`);

		const extensions = collectClientExtensions({ cwd, agentDir });

		expect(extensions).toHaveLength(1);
		expect(extensions[0]?.path).toBe(path);
		expect(extensions[0]?.side).toBe("client");
		expect(extensions[0]?.hash).toMatch(/^[0-9a-f]{12}$/);
	});
});
