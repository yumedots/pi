import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { buildRouteTable, REQUIRED_OPENCODE_ROUTES, routeKey, SERVER_CORE_ROUTES } from "../src/routes/required.ts";

/** The committed opencode OpenAPI schema. */
const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/opencode-openapi.json", import.meta.url));

/**
 * The routes of the openapi schema, as `METHOD path` keys.
 */
function opencodeRouteKeys(): Set<string> {
	const schema = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
		paths?: Record<string, Record<string, unknown>>;
	};
	const keys = new Set<string>();
	for (const [path, operations] of Object.entries(schema.paths ?? {})) {
		for (const method of ["get", "post", "put", "patch", "delete"]) {
			if (!operations[method]) continue;
			keys.add(routeKey(method, path));
		}
	}
	return keys;
}

describe("the opencode route parity", () => {
	const table = buildRouteTable();
	const implemented = new Set(table.routes().map((route) => routeKey(route.method, route.path)));

	test("every required route is registered", () => {
		const missing = REQUIRED_OPENCODE_ROUTES.filter(
			(route) => !implemented.has(routeKey(route.method, route.path)),
		).map((route) => `${route.method} ${route.path}`);
		expect(missing).toEqual([]);
	});

	test("the opencode schema has every required route", () => {
		const opencode = opencodeRouteKeys();
		const missing = REQUIRED_OPENCODE_ROUTES.filter((route) => !opencode.has(routeKey(route.method, route.path))).map(
			(route) => `${route.method} ${route.path}`,
		);
		expect(missing).toEqual([]);
	});

	test("the core routes of the server are registered", () => {
		const missing = SERVER_CORE_ROUTES.filter((route) => !implemented.has(routeKey(route.method, route.path))).map(
			(route) => `${route.method} ${route.path}`,
		);
		expect(missing).toEqual([]);
	});
});
