import assert from "node:assert";
import { describe, it } from "node:test";
import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";

describe("CombinedAutocompleteProvider @ mentions", () => {
	const mentions = [
		{ value: "@opencode", label: "@opencode", description: "Use this skill for any question about OpenCode itself" },
		{ value: "@openreport", label: "@openreport", description: "Use when the user wants to report an issue" },
	];

	function provider(): CombinedAutocompleteProvider {
		return new CombinedAutocompleteProvider([], process.cwd(), null, mentions);
	}

	async function suggestionsFor(line: string) {
		const result = await provider().getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});
		return result;
	}

	it("lists all mentions for an @ prefix", async () => {
		const result = await suggestionsFor("@");
		assert.ok(result);
		assert.deepStrictEqual(
			result.items.map((item) => item.value),
			["@opencode", "@openreport"],
		);
		assert.equal(result.items[0]?.description, "Use this skill for any question about OpenCode itself");
	});

	it("filters mentions by the text after the @", async () => {
		const result = await suggestionsFor("@report");
		assert.ok(result);
		assert.deepStrictEqual(
			result.items.map((item) => item.value),
			["@openreport"],
		);
	});

	it("inserts the mention followed by a space", async () => {
		const autocomplete = provider();
		const line = "@report";
		const result = await autocomplete.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});
		assert.ok(result);
		const applied = autocomplete.applyCompletion([line], 0, line.length, result.items[0]!, result.prefix);
		assert.equal(applied.lines[0], "@openreport ");
		assert.equal(applied.cursorCol, "@openreport ".length);
	});

	it("keeps text before the mention", async () => {
		const autocomplete = provider();
		const line = "check @report";
		const result = await autocomplete.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});
		assert.ok(result);
		const applied = autocomplete.applyCompletion([line], 0, line.length, result.items[0]!, result.prefix);
		assert.equal(applied.lines[0], "check @openreport ");
	});
});
