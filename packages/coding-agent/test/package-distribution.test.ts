import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

interface CodingAgentPackageJson {
	bin?: Record<string, string>;
	main: string;
	exports: {
		".": { import: string; types: string };
		"./rpc-entry": { import: string };
	};
}

const packageJson = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as CodingAgentPackageJson;

describe("package distribution entrypoints", () => {
	test("uses the bundle for executables and modular output for libraries", () => {
		// The `pi` binary lives in the client package, which drives this one over HTTP.
		expect(packageJson.bin).toBeUndefined();
		expect(packageJson.main).toBe("./dist/index.js");
		expect(packageJson.exports["."].import).toBe("./dist/index.js");
		expect(packageJson.exports["./rpc-entry"].import).toBe("./dist/bundle/rpc-entry.js");
	});
});
