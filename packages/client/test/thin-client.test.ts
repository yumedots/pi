/**
 * The client must stay thin.
 *
 * The client is a terminal UI: it talks to a pi server over HTTP and SSE, and it hosts
 * no agent runtime of its own. That is easy to lose by accident. A single value import
 * of the server package pulls the whole server into the client (the session registry,
 * the agent runtime, the extension machinery), and a single value import of the coding
 * agent's model runtime pulls the static model catalog (1600 models) into the client.
 *
 * The guard is the module graph itself: the client walks its own value imports and
 * fails when the server's runtime or the catalog is reachable. The check runs twice:
 * once over the sources of the client, and once over the modules a running client
 * really loaded.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";

/** The root of the repository, three levels above this file. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The sources of the client. */
const CLIENT_SRC = join(REPO_ROOT, "packages/client/src");

/** The workspace packages, so that an import of one of them is followed into its source. */
const WORKSPACE: Record<string, string> = {
	"@earendil-works/chord": "packages/chord/src",
	"@earendil-works/pi-ai": "packages/ai/src",
	"@earendil-works/pi-agent-core": "packages/agent/src",
	"@earendil-works/pi-codemode": "packages/codemode/src",
	"@earendil-works/pi-mcp": "packages/mcp/src",
	"@earendil-works/pi-tui": "packages/tui/src",
	"@earendil-works/pi-coding-agent": "packages/coding-agent/src",
	"@earendil-works/pi-server": "packages/server/src",
	"@earendil-works/pi-client": "packages/client/src",
};

/**
 * The server files the client may load.
 *
 * The SDK and the auth helper behind it are the whole client surface of the server
 * package. Everything else is the server's runtime.
 */
const ALLOWED_SERVER_FILES: Record<string, true> = {
	"packages/server/src/client.ts": true,
	"packages/server/src/auth.ts": true,
};

/**
 * The files that carry the static model catalog.
 *
 * The catalog is the server's business: the client reads the models from the server.
 */
const CATALOG_FILES = ["packages/ai/src/models.generated.ts", "packages/ai/src/providers/all.ts"];

/**
 * The value imports of a file.
 *
 * `import type` and `export type` are erased before the runtime sees them, so they cost
 * nothing and are not part of the graph.
 */
const VALUE_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)([^;]*?\sfrom\s*)?["']([^"']+)["']/g;

/** The directories the temporary files of the run live in. */
const tempDirs: string[] = [];

/**
 * The sources of the client, every file of them.
 */
function clientSources(dir: string = CLIENT_SRC): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			files.push(...clientSources(path));
			continue;
		}
		if (entry.endsWith(".ts")) files.push(path);
	}
	return files;
}

/**
 * The file a specifier points at, or nothing when it points outside the workspace.
 */
function resolveSpec(spec: string, fromFile: string): string | undefined {
	if (spec.startsWith("node:")) return undefined;
	if (spec.startsWith(".")) {
		const base = resolve(dirname(fromFile), spec);
		for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
			if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
		}
		return undefined;
	}
	for (const [name, src] of Object.entries(WORKSPACE)) {
		if (spec === name) return resolve(REPO_ROOT, src, "index.ts");
		if (!spec.startsWith(`${name}/`)) continue;
		const tail = spec.slice(name.length + 1);
		for (const candidate of [`${tail}.ts`, `${tail}/index.ts`, tail]) {
			const file = resolve(REPO_ROOT, src, candidate);
			if (existsSync(file) && statSync(file).isFile()) return file;
		}
	}
	return undefined;
}

/**
 * The value imports of a file.
 */
function valueImports(file: string): string[] {
	const specs: string[] = [];
	for (const match of readFileSync(file, "utf8").matchAll(VALUE_IMPORT)) {
		if (match[2]) specs.push(match[2]);
	}
	return specs;
}

/**
 * The value import graph of the client, as paths relative to the repository.
 *
 * The files of `skipped` are part of the graph, but their imports are not followed.
 */
function clientGraph(skipped: readonly string[] = []): Set<string> {
	const skip = new Set(skipped.map((file) => resolve(REPO_ROOT, file)));
	const seen = new Set<string>();
	const queue = clientSources();
	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || seen.has(file)) continue;
		seen.add(file);
		if (skip.has(file)) continue;
		for (const spec of valueImports(file)) {
			const target = resolveSpec(spec, file);
			if (target) queue.push(target);
		}
	}
	return new Set([...seen].map((file) => relative(REPO_ROOT, file)));
}

/**
 * The bun binary, when the run has one.
 */
function findBun(): string | undefined {
	if (process.execPath.endsWith("bun") || process.execPath.endsWith("bun.exe")) return process.execPath;
	for (const dir of (process.env.PATH ?? "").split(":")) {
		const candidate = join(dir, "bun");
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

describe("the thin client", () => {
	afterAll(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the client does not import the server package itself", () => {
		const offenders = clientSources().filter((file) => valueImports(file).includes("@earendil-works/pi-server"));
		expect(offenders.map((file) => relative(REPO_ROOT, file))).toEqual([]);
	});

	test("the module graph of the client does not reach the server runtime", () => {
		const graph = clientGraph();
		const serverFiles = [...graph].filter((file) => file.startsWith("packages/server/src/"));
		const runtime = serverFiles.filter((file) => ALLOWED_SERVER_FILES[file] !== true);
		expect(runtime).toEqual([]);
	});

	test("the module graph of the client does not reach the coding agent", () => {
		// The client is a renderer: it draws what the server tells it to draw. It must
		// not load the coding agent at all, not even a part of it. The client and the
		// server would hold the same core twice, in two processes, and the memory of
		// the pair would be the memory of the agent twice.
		//
		// `import type` is erased before the runtime sees it, so the type imports of the
		// coding agent cost nothing and stay allowed. The graph below follows the value
		// imports only.
		const graph = clientGraph();
		const codingAgent = [...graph].filter((file) => file.startsWith("packages/coding-agent/"));
		expect(codingAgent).toEqual([]);
	});

	test("the client does not import the model runtime or the catalog itself", () => {
		// The catalog is the server's business: the client reads the models from the
		// server. It may not import the model runtime or the catalog itself.
		const offenders = clientSources().filter((file) =>
			valueImports(file).some((spec) => {
				const target = resolveSpec(spec, file);
				if (!target) return false;
				const path = relative(REPO_ROOT, target);
				return path === "packages/coding-agent/src/core/model-runtime.ts" || CATALOG_FILES.includes(path);
			}),
		);
		expect(offenders.map((file) => relative(REPO_ROOT, file))).toEqual([]);
	});

	test("a running client loads neither the server runtime nor the catalog", () => {
		const bun = findBun();
		if (!bun) {
			// The module registry of a running process is only readable under bun. The
			// graph checks above hold either way.
			return;
		}
		const dir = mkdtempSync(join(tmpdir(), "pi-thin-client-"));
		tempDirs.push(dir);
		const script = join(dir, "load-client.ts");
		writeFileSync(
			script,
			[
				`import ${JSON.stringify(join(CLIENT_SRC, "cli.ts"))};`,
				`import ${JSON.stringify(join(CLIENT_SRC, "interactive-mode.ts"))};`,
				// The module registry of bun holds the modules the process loaded.
				"console.log(JSON.stringify(Object.keys(require.cache)));",
				"",
			].join("\n"),
			"utf-8",
		);
		const output = execFileSync(bun, [script], { encoding: "utf8", cwd: REPO_ROOT });
		const loaded = (JSON.parse(output.trim()) as string[]).map((file) => relative(REPO_ROOT, file));
		const runtime = loaded.filter(
			(file) => file.startsWith("packages/server/src/") && ALLOWED_SERVER_FILES[file] !== true,
		);
		expect(runtime).toEqual([]);
		const codingAgent = loaded.filter((file) => file.startsWith("packages/coding-agent/"));
		expect(codingAgent).toEqual([]);
	});
});
