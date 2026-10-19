import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runClipboardCommand } from "../src/utils/clipboard-command.ts";

// A stand-in for a clipboard writer. It is a script file instead of an inline
// expression, because the runtimes disagree on how an empty inline expression is
// handled: Node writes nothing, Bun prints its usage.
const SCRIPT = `
const mode = process.argv[2];
if (mode === "binary") {
	process.stdout.write(Buffer.from([0, 255, 10]));
} else if (mode === "exit") {
	process.exit(1);
} else if (mode === "stdin") {
	let text = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk) => { text += chunk; });
	process.stdin.on("end", () => { process.exit(text === "café 日本語" ? 0 : 1); });
} else if (mode === "hang") {
	setInterval(() => {}, 1000);
} else if (mode === "big") {
	process.stdout.write(Buffer.alloc(1024));
}
`;

describe("clipboard commands", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		while (tempDirs.length > 0) rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
	});

	function writeScript(): string {
		const dir = mkdtempSync(join(tmpdir(), "pi-clipboard-"));
		tempDirs.push(dir);
		const scriptPath = join(dir, "writer.mjs");
		writeFileSync(scriptPath, SCRIPT);
		return scriptPath;
	}

	test("preserves binary output and distinguishes empty success from failure", async () => {
		const scriptPath = writeScript();
		expect(await runClipboardCommand(process.execPath, [scriptPath, "binary"])).toEqual(Buffer.from([0, 255, 10]));
		expect(await runClipboardCommand(process.execPath, [scriptPath, "empty"])).toEqual(Buffer.alloc(0));
		expect(await runClipboardCommand(process.execPath, [scriptPath, "exit"])).toBeUndefined();
		expect(await runClipboardCommand("pi-clipboard-command-does-not-exist", [])).toBeUndefined();
	});
	test("sends Unicode input to clipboard writers", async () => {
		const scriptPath = writeScript();
		expect(await runClipboardCommand(process.execPath, [scriptPath, "stdin"], { input: "café 日本語" })).toEqual(
			Buffer.alloc(0),
		);
	});
	test("times out without blocking the event loop", async () => {
		const scriptPath = writeScript();
		// The interval counts the ticks of the real event loop, which is what the test is
		// about: the timeout has to give the loop back to the process. A fake clock would
		// not show that.
		let ticks = 0;
		const timer = setInterval(() => ticks++, 10);
		try {
			expect(await runClipboardCommand(process.execPath, [scriptPath, "hang"], { timeoutMs: 200 })).toBeUndefined();
			expect(ticks).toBeGreaterThan(5);
		} finally {
			clearInterval(timer);
		}
	});
	test("rejects output above the buffer limit", async () => {
		const scriptPath = writeScript();
		expect(
			await runClipboardCommand(process.execPath, [scriptPath, "big"], {
				maxBufferBytes: 16,
			}),
		).toBeUndefined();
	});
});
