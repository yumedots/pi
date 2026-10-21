import { describe, expect, test } from "vitest";
import { initTheme } from "../../coding-agent/src/core/theme/theme.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import { ThinkingIndicator } from "../src/components/thinking-indicator.ts";

describe("ThinkingIndicator", () => {
	test("advances the braille sign while the message streams", () => {
		initTheme("dark");
		let clock = 0;
		const indicator = new ThinkingIndicator("Thinking...", 1, true, () => clock);

		expect(stripAnsi(indicator.render(40).join("\n"))).toContain("⠋ Thinking...");
		clock = 80;
		expect(stripAnsi(indicator.render(40).join("\n"))).toContain("⠙ Thinking...");
		clock = 720;
		expect(stripAnsi(indicator.render(40).join("\n"))).toContain("⠏ Thinking...");
	});

	test("keeps the first frame once the message is done", () => {
		initTheme("dark");
		const indicator = new ThinkingIndicator("Thinking...", 1, false, () => 800);

		expect(stripAnsi(indicator.render(40).join("\n"))).toContain("⠋ Thinking...");
	});
});
