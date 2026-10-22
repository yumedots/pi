import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkReplaceable, planSelfInstall } from "../src/cli.ts";

const isWindows = process.platform === "win32";
const binaryName = isWindows ? "pi.exe" : "pi";
const serverBinaryName = isWindows ? "pi-server.exe" : "pi-server";
const linkName = isWindows ? "pi.cmd" : "pi";
const serverLinkName = isWindows ? "pi-server.cmd" : "pi-server";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-self-install-test-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("planSelfInstall", () => {
	test("uses the release layout by default", () => {
		const plan = planSelfInstall({ home: "/home/pi" });

		expect(plan.installDir).toBe("/home/pi/.local/lib/pi");
		expect(plan.binDir).toBe("/home/pi/.local/bin");
		expect(plan.binaryPath).toBe(`/home/pi/.local/lib/pi/${binaryName}`);
		expect(plan.serverPath).toBe(`/home/pi/.local/lib/pi/${serverBinaryName}`);
		expect(plan.linkPath).toBe(`/home/pi/.local/bin/${linkName}`);
		expect(plan.serverLinkPath).toBe(`/home/pi/.local/bin/${serverLinkName}`);
	});

	test("takes the directories from the flags", () => {
		const plan = planSelfInstall({ installDir: "/opt/pi", binDir: "/opt/bin", home: "/home/pi" });

		expect(plan.installDir).toBe("/opt/pi");
		expect(plan.binDir).toBe("/opt/bin");
		expect(plan.binaryPath).toBe(`/opt/pi/${binaryName}`);
		expect(plan.linkPath).toBe(`/opt/bin/${linkName}`);
	});

	test("expands a leading tilde", () => {
		const plan = planSelfInstall({ installDir: "~/pi", binDir: "~/bin", home: "/home/pi" });

		expect(plan.installDir).toBe("/home/pi/pi");
		expect(plan.binDir).toBe("/home/pi/bin");
	});
});

describe("checkReplaceable", () => {
	test("allows a path that does not exist", () => {
		expect(checkReplaceable(join(root, "pi"), root).allowed).toBe(true);
	});

	test.skipIf(isWindows)("allows a link into the install directory", () => {
		const installDir = join(root, "lib", "pi");
		mkdirSync(installDir, { recursive: true });
		writeFileSync(join(installDir, binaryName), "binary");
		const linkPath = join(root, "bin", linkName);
		mkdirSync(join(root, "bin"), { recursive: true });
		symlinkSync(join(installDir, binaryName), linkPath);

		expect(checkReplaceable(linkPath, installDir).allowed).toBe(true);
	});

	test.skipIf(isWindows)("refuses a link that points somewhere else", () => {
		const installDir = join(root, "lib", "pi");
		mkdirSync(installDir, { recursive: true });
		const other = join(root, "other", binaryName);
		mkdirSync(join(root, "other"), { recursive: true });
		writeFileSync(other, "binary");
		const linkPath = join(root, "bin", linkName);
		mkdirSync(join(root, "bin"), { recursive: true });
		symlinkSync(other, linkPath);

		const check = checkReplaceable(linkPath, installDir);
		expect(check.allowed).toBe(false);
		expect(check.reason).toContain(other);
	});

	test("refuses a file that pi did not create", () => {
		const installDir = join(root, "lib", "pi");
		mkdirSync(installDir, { recursive: true });
		const linkPath = join(root, "bin", linkName);
		mkdirSync(join(root, "bin"), { recursive: true });
		writeFileSync(linkPath, "not ours");

		const check = checkReplaceable(linkPath, installDir);
		expect(check.allowed).toBe(false);
		expect(check.reason).toContain("pi did not create");
	});
});
