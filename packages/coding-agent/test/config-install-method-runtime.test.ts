import { describe, expect, test } from "vitest";
import { detectInstallMethod, isBunRuntime } from "../src/config.ts";

// The runtime branch of the install-method detection.
//
// config.test.ts stubs process.versions.bun out before it imports the config
// module, so that the install-path detection is exercised on Bun as well.
// This file does not stub, and covers the branch the stub hides.
describe("detectInstallMethod on the Bun runtime", () => {
	test.skipIf(!isBunRuntime())("reports bun for an install path that names no package manager", () => {
		// The path below names no package manager, so only the runtime can
		// answer "bun".
		expect(detectInstallMethod()).toBe("bun");
	});
});
