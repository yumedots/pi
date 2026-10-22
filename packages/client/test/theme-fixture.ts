/**
 * The theme of the tests.
 *
 * The client draws with its own theme: the tokens come from the server, the escape
 * sequences are the client's own. The tests need a theme to draw with, so they install
 * the dark theme of the coding agent, the way the server sends it.
 *
 * The coding agent keeps its own theme as well: the tool definitions the tests build with
 * carry the renderers of the coding agent, and those renderers draw with its theme.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initTheme } from "../../coding-agent/src/core/theme/theme.ts";
import { setThemeFromJson } from "../src/client-theme.ts";

/**
 * Install the theme of the coding agent as the theme of the client.
 */
export function initThemeFixture(name: "dark" | "light"): void {
	initTheme(name);
	const document = JSON.parse(
		readFileSync(join(import.meta.dirname, `../../coding-agent/src/core/theme/${name}.json`), "utf-8"),
	) as unknown;
	setThemeFromJson(document);
}

/**
 * Install the dark theme as the theme of the client.
 */
export function initDarkTheme(): void {
	initThemeFixture("dark");
}

/**
 * Install the light theme as the theme of the client.
 */
export function initLightTheme(): void {
	initThemeFixture("light");
}
