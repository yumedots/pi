import assert from "node:assert";
import { describe, it } from "node:test";
import { SPINNER_FRAME_INTERVAL_MS, SPINNER_FRAMES, spinnerFrame } from "../src/spinner.ts";

describe("spinnerFrame", () => {
	it("exposes the braille frame list", () => {
		assert.deepStrictEqual([...SPINNER_FRAMES], ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
		assert.strictEqual(SPINNER_FRAME_INTERVAL_MS, 80);
	});

	it("advances one frame per interval", () => {
		assert.strictEqual(spinnerFrame(0), "⠋");
		assert.strictEqual(spinnerFrame(80), "⠙");
		assert.strictEqual(spinnerFrame(800), "⠋");
	});

	it("returns an empty string when there are no frames", () => {
		assert.strictEqual(spinnerFrame(0, []), "");
	});
});
