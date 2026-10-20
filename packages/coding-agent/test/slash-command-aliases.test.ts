import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS, resolveBuiltinSlashAlias } from "../src/core/slash-commands.ts";

describe("slash command aliases", () => {
	it("runs the command an alias points at", () => {
		expect(resolveBuiltinSlashAlias("/history")).toBe("/resume");
		expect(resolveBuiltinSlashAlias("/sessions")).toBe("/resume");
	});

	it("leaves commands and messages alone", () => {
		expect(resolveBuiltinSlashAlias("/resume")).toBe("/resume");
		expect(resolveBuiltinSlashAlias("/new")).toBe("/new");
		expect(resolveBuiltinSlashAlias("/history of my run")).toBe("/history of my run");
		expect(resolveBuiltinSlashAlias("tell me about /history")).toBe("tell me about /history");
		expect(resolveBuiltinSlashAlias("")).toBe("");
	});

	it("has no alias that another command already uses", () => {
		const names = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
		for (const command of BUILTIN_SLASH_COMMANDS) {
			for (const alias of command.aliases ?? []) {
				expect(names.has(alias), `/${alias} is already a command name`).toBe(false);
			}
		}
	});

	it("has no alias twice", () => {
		const aliases = BUILTIN_SLASH_COMMANDS.flatMap((command) => command.aliases ?? []);
		expect(new Set(aliases).size).toBe(aliases.length);
	});
});
