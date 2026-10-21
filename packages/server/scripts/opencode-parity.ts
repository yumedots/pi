#!/usr/bin/env bun
/**
 * The opencode parity harness.
 *
 * The harness compares the opencode API with the pi server:
 *
 * - `--update` refreshes the committed opencode OpenAPI fixture from the opencode clone.
 * - the default run reads the fixture, reads the server's real route table and prints
 *   what the server implements, what it misses and what opencode has that pi does not.
 *
 * The fixture is committed, so the default run never touches the network.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	REQUIRED_OPENCODE_ROUTES,
	buildRouteTable,
	routeKey,
} from "../src/routes/required.ts";
import { startServer } from "../src/server.ts";
import type { SessionRegistry } from "../src/session-registry.ts";

/** The opencode clone the fixture comes from. */
const REFERENCE_DIR = join(process.env.TMPDIR ?? tmpdir(), "pi-opencode-ref");

/** The committed opencode OpenAPI schema. */
const FIXTURE_PATH = fileURLToPath(new URL("../test/fixtures/opencode-openapi.json", import.meta.url));

/** The HTTP methods the openapi schema uses. */
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/**
 * A registry without sessions, so the harness never needs a runtime.
 */
function stubRegistry(): SessionRegistry {
	return {
		sessions: new Map(),
		list: async () => [],
		get: () => undefined,
		close: async () => {},
		closeAll: async () => {},
	} as unknown as SessionRegistry;
}

/**
 * The route table of a running server.
 *
 * The server binds a free port and writes its registration file into a temporary agent
 * directory, so the harness reads the real table without touching the agent directory of
 * the user.
 */
async function realRouteTable(): Promise<ReadonlyArray<{ method: string; path: string }>> {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-parity-agent-"));
	const server = await startServer({
		port: 0,
		password: "parity",
		agentDir,
		registry: stubRegistry(),
	});
	try {
		return server.router.routes();
	} finally {
		await server.close();
		rmSync(agentDir, { recursive: true, force: true });
	}
}

/**
 * The routes that the server registers and the harness does not know about, and the other
 * way round. A difference means that `SERVER_CORE_ROUTES` drifted from `server.ts`.
 */
function routeTableDrift(
	real: ReadonlyArray<{ method: string; path: string }>,
	built: ReadonlyArray<{ method: string; path: string }>,
): string[] {
	const realKeys = new Set(real.map((route) => routeKey(route.method, route.path)));
	const builtKeys = new Set(built.map((route) => routeKey(route.method, route.path)));
	return [
		...[...realKeys].filter((key) => !builtKeys.has(key)).map((key) => `only the server has ${key}`),
		...[...builtKeys].filter((key) => !realKeys.has(key)).map((key) => `only the harness has ${key}`),
	];
}

/**
 * The routes of the openapi schema, as `METHOD path` keys.
 */
export function opencodeRouteKeys(schema: { paths?: Record<string, Record<string, unknown>> }): Set<string> {
	const keys = new Set<string>();
	for (const [path, operations] of Object.entries(schema.paths ?? {})) {
		for (const method of HTTP_METHODS) {
			if (!operations[method]) continue;
			keys.add(routeKey(method, path));
		}
	}
	return keys;
}

/**
 * Refresh the fixture from the opencode clone.
 */
function updateFixture(): void {
	if (!existsSync(join(REFERENCE_DIR, ".git"))) {
		console.log(`cloning opencode into ${REFERENCE_DIR}`);
		execFileSync("git", ["clone", "--depth", "1", "https://github.com/sst/opencode.git", REFERENCE_DIR], {
			stdio: "inherit",
		});
	} else {
		console.log(`updating the opencode clone in ${REFERENCE_DIR}`);
		execFileSync("git", ["pull", "--ff-only"], { cwd: REFERENCE_DIR, stdio: "inherit" });
	}
	const source = join(REFERENCE_DIR, "packages/protocol/openapi.json");
	if (!existsSync(source)) {
		throw new Error(`the opencode clone has no ${source}`);
	}
	copyFileSync(source, FIXTURE_PATH);
	console.log(`wrote ${FIXTURE_PATH}`);
}

/**
 * Print the parity report.
 */
async function report(): Promise<number> {
	const schema = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
		paths?: Record<string, Record<string, unknown>>;
	};
	const opencodeKeys = opencodeRouteKeys(schema);
	const implemented = await realRouteTable();
	const implementedKeys = new Map<string, string>();
	for (const route of implemented) {
		implementedKeys.set(routeKey(route.method, route.path), `${route.method} ${route.path}`);
	}

	const requiredAndImplemented: string[] = [];
	const requiredAndMissing: string[] = [];
	for (const route of REQUIRED_OPENCODE_ROUTES) {
		const key = routeKey(route.method, route.path);
		if (implementedKeys.has(key)) {
			requiredAndImplemented.push(`${route.method} ${route.path}`);
		} else {
			requiredAndMissing.push(`${route.method} ${route.path}`);
		}
	}

	const implementedButNotInOpencode = [...implementedKeys.entries()]
		.filter(([key]) => !opencodeKeys.has(key))
		.map(([, display]) => display)
		.sort();
	const opencodeOnly = [...opencodeKeys.values()]
		.filter((key) => !implementedKeys.has(key))
		.sort();

	printSection("required and implemented", requiredAndImplemented);
	printSection("required and missing", requiredAndMissing);
	printSection("implemented but not in opencode", implementedButNotInOpencode);
	printSection("opencode-only (not implemented)", opencodeOnly);

	const drift = routeTableDrift(implemented, buildRouteTable().routes());
	printSection("route table drift", drift);

	if (requiredAndMissing.length > 0) {
		console.error(`\n${requiredAndMissing.length} required route(s) are missing.`);
		return 1;
	}
	console.log("\nevery required route is implemented.");
	return 0;
}

function printSection(title: string, entries: string[]): void {
	console.log(`\n${title} (${entries.length})`);
	for (const entry of entries) {
		console.log(`  ${entry}`);
	}
}

if (process.argv.includes("--update")) {
	updateFixture();
} else {
	process.exitCode = await report();
}
