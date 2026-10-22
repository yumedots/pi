import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import type { JsonValue, Tool, ToolCall } from "../src/types.ts";
import { validateToolArguments } from "../src/utils/validation.ts";

/**
 * The validation runs without TypeBox's runtime, so it has to behave exactly like
 * TypeBox's own converter and validator. These cases pin that equivalence: the same
 * schema and the same arguments must produce the same result and the same errors.
 */
const schemas: Record<string, Tool["parameters"]> = {
	object: Type.Object({ count: Type.Number() }),
	optional: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Number()) }),
	nullable: Type.Object({ value: Type.Union([Type.Number(), Type.Null()]) }),
	stringUnion: Type.Object({ value: Type.Union([Type.String(), Type.Number()]) }),
	array: Type.Object({ items: Type.Array(Type.String()) }),
	arrayOfObjects: Type.Object({ items: Type.Array(Type.Object({ id: Type.String() })) }),
	record: Type.Object({ map: Type.Record(Type.String(), Type.Number()) }),
	enum: Type.Object({ mode: Type.Enum({ read: "read", write: "write" }) }),
	literal: Type.Object({ kind: Type.Literal("a") }),
	integer: Type.Object({ count: Type.Integer() }),
	boolean: Type.Object({ flag: Type.Boolean() }),
	nested: Type.Object({ outer: Type.Object({ inner: Type.String() }) }),
	partial: Type.Object({ outer: Type.Partial(Type.Object({ inner: Type.String() })) }),
};

const argumentsList: unknown[] = [
	// A null for an optional property is dropped before the conversion, which TypeBox
	// itself would turn into a zero. The other tests cover that rule.
	null,
	true,
	false,
	0,
	1,
	42,
	42.5,
	"",
	"0",
	"1",
	"42",
	"true",
	"false",
	"null",
	"abc",
	[],
	[1, 2],
	["a", "b"],
	{},
	{ a: 1 },
	{ a: "1" },
	{ a: null },
	{ count: "42" },
	{ count: 42 },
	{ count: null },
	{ count: 42.5 },
	{ path: "file.txt", offset: "7" },
	// An optional property set to undefined counts as absent, the way TypeBox reads it.
	{ path: "file.txt", offset: undefined },
	{ value: null },
	{ value: "42" },
	{ items: ["a"] },
	{ items: [1] },
	{ map: { a: "1" } },
	{ mode: "read" },
	{ mode: "other" },
	{ kind: "a" },
	{ outer: { inner: "x" } },
	{ outer: {} },
];

function referenceResult(schema: Tool["parameters"], args: unknown): string {
	const clone = structuredClone(args);
	const converted = Value.Convert(schema, clone);
	const finalArgs = converted !== null && typeof converted === "object" ? converted : clone;
	const validator = Compile(schema);
	if (validator.Check(finalArgs)) {
		return `ok:${JSON.stringify(finalArgs)}`;
	}
	const errors = (validator.Errors(finalArgs) ?? [])
		.map((error) => {
			const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
			if (error.keyword === "required") {
				const requiredProperty = (error.params as { requiredProperties?: string[] })?.requiredProperties?.[0];
				if (requiredProperty) {
					return `  - ${path ? `${path}.${requiredProperty}` : requiredProperty}: ${error.message}`;
				}
			}
			return `  - ${path || "root"}: ${error.message}`;
		})
		.join("\n");
	return `err:${errors}`;
}

function validationResult(schema: Tool["parameters"], args: unknown): string {
	const tool: Tool = { name: "echo", description: "Echo tool", parameters: schema };
	const toolCall: ToolCall = {
		type: "toolCall",
		id: "tool-1",
		name: "echo",
		arguments: structuredClone(args) as JsonValue as ToolCall["arguments"],
	};
	try {
		return `ok:${JSON.stringify(validateToolArguments(tool, toolCall))}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `err:${message.slice(message.indexOf("\n") + 1, message.indexOf("\n\nReceived arguments"))}`;
	}
}

describe("tool argument validation matches TypeBox", () => {
	for (const [name, schema] of Object.entries(schemas)) {
		it(`coerces and validates like TypeBox for the ${name} schema`, () => {
			for (const args of argumentsList) {
				expect(validationResult(schema, args), `${name} with ${JSON.stringify(args)}`).toBe(
					referenceResult(schema, args),
				);
			}
		});
	}
});
