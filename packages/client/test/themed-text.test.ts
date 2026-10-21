import { afterEach, describe, expect, it } from "vitest";
import { initTheme, theme } from "../../coding-agent/src/core/theme/theme.ts";
import { ThemedText } from "../src/components/themed-text.ts";

afterEach(() => {
	initTheme("dark");
});

describe("ThemedText", () => {
	it("builds lazily and rebuilds with the current theme after invalidation", () => {
		initTheme("dark");
		let builds = 0;
		const text = new ThemedText(() => {
			builds++;
			return theme.fg("accent", "hello");
		});
		expect(builds).toBe(0);
		const dark = text.render(20).join("");

		initTheme("light");
		expect(text.render(20).join("")).toBe(dark);
		text.invalidate();
		expect(text.render(20).join("")).toContain(theme.getFgAnsi("accent"));
		expect(builds).toBe(2);
	});
});
