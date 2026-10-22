import { afterEach, describe, expect, it } from "vitest";
import { theme } from "../src/client-theme.ts";
import { ThemedText } from "../src/components/themed-text.ts";
import { initDarkTheme, initLightTheme } from "./theme-fixture.ts";

afterEach(() => {
	initDarkTheme();
});

describe("ThemedText", () => {
	it("builds lazily and rebuilds with the current theme after invalidation", () => {
		initDarkTheme();
		let builds = 0;
		const text = new ThemedText(() => {
			builds++;
			return theme.fg("accent", "hello");
		});
		expect(builds).toBe(0);
		const dark = text.render(20).join("");

		initLightTheme();
		expect(text.render(20).join("")).toBe(dark);
		text.invalidate();
		expect(text.render(20).join("")).toContain(theme.getFgAnsi("accent"));
		expect(builds).toBe(2);
	});
});
