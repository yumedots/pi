import assert from "node:assert";
import { describe, it } from "node:test";
import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";

describe("CombinedAutocompleteProvider slash-command filter", () => {
	const commands = [{ name: "model", description: "Select the active model" }];

	async function suggestionsFor(prefix: string): Promise<string[]> {
		const provider = new CombinedAutocompleteProvider(commands, process.cwd());
		const line = `/${prefix}`;
		const result = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});
		assert.ok(result, `expected suggestions for "/${prefix}"`);
		return result.items.map((item) => item.value);
	}

	it("keeps ordinary slash commands matching", async () => {
		const items = await suggestionsFor("mod");
		assert.ok(items.includes("model"));
	});

	it("completes commands after leading whitespace and preserves it", async () => {
		const provider = new CombinedAutocompleteProvider([{ name: "model" }], process.cwd());
		for (const [line, expected] of [
			[" /", " /model "],
			["  /mod", "  /model "],
			["\t/mod", "\t/model "],
		] as const) {
			const result = await provider.getSuggestions([line], 0, line.length, {
				signal: new AbortController().signal,
			});
			assert.ok(result);
			assert.equal(result.prefix, line.trimStart());
			assert.deepStrictEqual(
				result.items.map((item) => item.value),
				["model"],
			);
			const applied = provider.applyCompletion([line], 0, line.length, result.items[0]!, result.prefix);
			assert.equal(applied.lines[0], expected);
			assert.equal(applied.cursorCol, expected.length);
		}
	});

	it("completes command arguments after leading whitespace", async () => {
		const provider = new CombinedAutocompleteProvider(
			[
				{
					name: "model",
					getArgumentCompletions: (prefix: string) => {
						assert.equal(prefix, "son");
						return [{ value: "sonnet", label: "sonnet" }];
					},
				},
			],
			process.cwd(),
		);
		const line = "  /model son";
		const result = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});
		assert.ok(result);
		assert.equal(result.prefix, "son");
		const applied = provider.applyCompletion([line], 0, line.length, result.items[0]!, result.prefix);
		assert.equal(applied.lines[0], "  /model sonnet");
	});
});
