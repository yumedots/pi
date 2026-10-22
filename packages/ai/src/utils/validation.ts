import type { Tool, ToolCall } from "../types.ts";

const TYPEBOX_KIND = Symbol.for("TypeBox.Kind");

/**
 * The JSON Schema subset that tool parameters use. TypeBox schemas are plain JSON Schema
 * objects at runtime, so the same shape describes both the TypeBox schemas and the
 * serialized plain schemas that MCP servers and plugins hand over.
 */
interface JsonSchemaObject {
	/** The marker TypeBox puts on the schemas it built, e.g. "Object" or "String". */
	"~kind"?: string;
	type?: string | string[];
	properties?: Record<string, JsonSchemaObject>;
	required?: string[];
	items?: JsonSchemaObject | JsonSchemaObject[];
	additionalProperties?: boolean | JsonSchemaObject;
	patternProperties?: Record<string, JsonSchemaObject>;
	allOf?: JsonSchemaObject[];
	anyOf?: JsonSchemaObject[];
	oneOf?: JsonSchemaObject[];
	const?: unknown;
	enum?: unknown[];
	minLength?: number;
	maxLength?: number;
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	multipleOf?: number;
	pattern?: string;
	minItems?: number;
	maxItems?: number;
	uniqueItems?: boolean;
}

/** A single validation failure, in the shape the error message reports it. */
interface SchemaError {
	/** JSON pointer to the offending value, empty for the root. */
	path: string;
	message: string;
	keyword: string;
	/** The missing property names, for the "required" keyword. */
	requiredProperties?: string[];
}

function getSchemaTypes(schema: JsonSchemaObject): string[] {
	if (typeof schema.type === "string") {
		return [schema.type];
	}
	if (Array.isArray(schema.type)) {
		return schema.type.filter((type): type is string => typeof type === "string");
	}
	return [];
}

function matchesJsonType(value: unknown, type: string): boolean {
	switch (type) {
		case "number":
			return typeof value === "number";
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		case "string":
			return typeof value === "string";
		case "null":
			return value === null;
		case "array":
			return Array.isArray(value);
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
		default:
			return false;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesPattern(pattern: string, key: string): boolean {
	try {
		return new RegExp(pattern).test(key);
	} catch {
		return false;
	}
}

function formatTypeList(types: string[]): string {
	if (types.length <= 1) {
		return types.join("");
	}
	return `${types.slice(0, -1).join(", ")} or ${types[types.length - 1]}`;
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

/**
 * Checks a value against a JSON Schema, collecting every failure.
 *
 * The messages and the order match the ones TypeBox's generated validators report, so the
 * error text a model sees does not change when TypeBox is not loaded.
 *
 * A property that is not required and holds `undefined` counts as absent, the way TypeBox
 * reads it: JSON has no `undefined`, and a repair may set an optional property to it.
 */
function collectSchemaErrors(value: unknown, schema: JsonSchemaObject, path: string): SchemaError[] {
	const errors: SchemaError[] = [];

	if (schema.const !== undefined && value !== schema.const) {
		errors.push({ path, message: "must be equal to constant", keyword: "const" });
		return errors;
	}

	if (schema.enum && !schema.enum.some((allowed) => allowed === value)) {
		errors.push({ path, message: "must be equal to one of the allowed values", keyword: "enum" });
		return errors;
	}

	const types = getSchemaTypes(schema);
	if (types.length === 1) {
		if (!matchesJsonType(value, types[0])) {
			errors.push({ path, message: `must be ${types[0]}`, keyword: "type" });
			return errors;
		}
	} else if (types.length > 1) {
		if (!types.some((type) => matchesJsonType(value, type))) {
			errors.push({ path, message: `must be either ${formatTypeList(types)}`, keyword: "type" });
			return errors;
		}
	}

	if (schema.anyOf) {
		const armErrors = schema.anyOf.map((arm) => collectSchemaErrors(value, arm, path));
		if (!armErrors.some((armError) => armError.length === 0)) {
			for (const armError of armErrors) errors.push(...armError);
			errors.push({ path, message: "must match a schema in anyOf", keyword: "anyOf" });
			return errors;
		}
	}

	if (schema.oneOf) {
		const armErrors = schema.oneOf.map((arm) => collectSchemaErrors(value, arm, path));
		if (armErrors.filter((armError) => armError.length === 0).length !== 1) {
			for (const armError of armErrors) errors.push(...armError);
			errors.push({ path, message: "must match exactly one schema in oneOf", keyword: "oneOf" });
			return errors;
		}
	}

	if (schema.allOf) {
		for (const arm of schema.allOf) {
			const armErrors = collectSchemaErrors(value, arm, path);
			if (armErrors.length > 0) {
				errors.push(...armErrors);
				return errors;
			}
		}
	}

	if (typeof value === "string") {
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			errors.push({
				path,
				message: `must not have fewer than ${schema.minLength} characters`,
				keyword: "minLength",
			});
			return errors;
		}
		if (schema.maxLength !== undefined && value.length > schema.maxLength) {
			errors.push({
				path,
				message: `must not have more than ${schema.maxLength} characters`,
				keyword: "maxLength",
			});
			return errors;
		}
		if (schema.pattern !== undefined && !matchesPattern(schema.pattern, value)) {
			errors.push({ path, message: `must match pattern "${schema.pattern}"`, keyword: "pattern" });
			return errors;
		}
	}

	if (typeof value === "number") {
		if (schema.minimum !== undefined && value < schema.minimum) {
			errors.push({ path, message: `must be >= ${schema.minimum}`, keyword: "minimum" });
			return errors;
		}
		if (schema.maximum !== undefined && value > schema.maximum) {
			errors.push({ path, message: `must be <= ${schema.maximum}`, keyword: "maximum" });
			return errors;
		}
		if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
			errors.push({ path, message: `must be > ${schema.exclusiveMinimum}`, keyword: "exclusiveMinimum" });
			return errors;
		}
		if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
			errors.push({ path, message: `must be < ${schema.exclusiveMaximum}`, keyword: "exclusiveMaximum" });
			return errors;
		}
		if (schema.multipleOf !== undefined && value % schema.multipleOf !== 0) {
			errors.push({ path, message: `must be multiple of ${schema.multipleOf}`, keyword: "multipleOf" });
			return errors;
		}
	}

	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) {
			errors.push({
				path,
				message: `must not have fewer than ${schema.minItems} items`,
				keyword: "minItems",
			});
			return errors;
		}
		if (schema.maxItems !== undefined && value.length > schema.maxItems) {
			errors.push({
				path,
				message: `must not have more than ${schema.maxItems} items`,
				keyword: "maxItems",
			});
			return errors;
		}
		if (schema.uniqueItems && hasDuplicateItems(value)) {
			errors.push({ path, message: "must not have duplicate items", keyword: "uniqueItems" });
			return errors;
		}
		const items = schema.items;
		if (items) {
			if (Array.isArray(items)) {
				for (let index = 0; index < items.length && index < value.length; index++) {
					const itemSchema = items[index];
					if (itemSchema) {
						errors.push(...collectSchemaErrors(value[index], itemSchema, `${path}/${index}`));
					}
				}
			} else {
				for (let index = 0; index < value.length; index++) {
					errors.push(...collectSchemaErrors(value[index], items, `${path}/${index}`));
				}
			}
		}
	}

	if (isPlainObject(value)) {
		const properties = schema.properties ?? {};
		const patternProperties = schema.patternProperties ?? {};
		const required = new Set(schema.required ?? []);
		const missing = [...required].filter((key) => !(key in value));
		if (missing.length > 0) {
			errors.push({
				path,
				message: `must have required properties ${missing.join(", ")}`,
				keyword: "required",
				requiredProperties: missing,
			});
		}
		for (const [key, propertySchema] of Object.entries(properties)) {
			if (!(key in value)) continue;
			if (value[key] === undefined && !required.has(key)) continue;
			errors.push(...collectSchemaErrors(value[key], propertySchema, `${path}/${key}`));
		}
		for (const [pattern, propertySchema] of Object.entries(patternProperties)) {
			for (const [key, entryValue] of Object.entries(value)) {
				if (!matchesPattern(pattern, key)) continue;
				errors.push(...collectSchemaErrors(entryValue, propertySchema, `${path}/${key}`));
			}
		}
		const additional = schema.additionalProperties;
		if (additional !== undefined) {
			const extraKeys = Object.keys(value).filter(
				(key) =>
					!(key in properties) && !Object.keys(patternProperties).some((pattern) => matchesPattern(pattern, key)),
			);
			let rejectedExtraKey = false;
			for (const key of extraKeys) {
				if (additional === false) {
					rejectedExtraKey = true;
					errors.push({ path: `${path}/${key}`, message: "schema is false", keyword: "boolean" });
				} else if (isPlainObject(additional)) {
					const additionalErrors = collectSchemaErrors(value[key], additional, `${path}/${key}`);
					if (additionalErrors.length > 0) {
						rejectedExtraKey = true;
						errors.push(...additionalErrors);
					}
				}
			}
			if (rejectedExtraKey) {
				errors.push({ path, message: "must not have additional properties", keyword: "additionalProperties" });
			}
		}
	}

	return errors;
}

function hasDuplicateItems(items: unknown[]): boolean {
	return items.some((item, index) => items.indexOf(item) !== index);
}

function formatValidationPath(error: SchemaError): string {
	if (error.keyword === "required" && error.requiredProperties?.length) {
		const requiredProperty = error.requiredProperties[0];
		const basePath = error.path.replace(/^\//, "").replace(/\//g, ".");
		return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
	}
	const path = error.path.replace(/^\//, "").replace(/\//g, ".");
	return path || "root";
}

// --------------------------------------------------------------------------
// Coercion of TypeBox schemas
// --------------------------------------------------------------------------

function tryString(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	if (value === null) return "null";
	if (value === undefined) return "";
	return undefined;
}

function tryNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (value === null || value === undefined) return 0;
	if (typeof value === "bigint") {
		const numeric = Number(value);
		return Number.isSafeInteger(numeric) ? numeric : undefined;
	}
	if (typeof value === "string") {
		const coerced = Number(value);
		if (Number.isFinite(coerced)) return coerced;
		const lowercase = value.toLowerCase();
		if (lowercase === "false") return 0;
		if (lowercase === "true") return 1;
	}
	return undefined;
}

function tryBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (value === 0) return false;
		if (value === 1) return true;
		return undefined;
	}
	if (value === null || value === undefined) return false;
	if (typeof value === "string") {
		const lowercase = value.toLowerCase();
		if (lowercase === "false") return false;
		if (lowercase === "true") return true;
		if (value === "0") return false;
		if (value === "1") return true;
	}
	return undefined;
}

function tryNull(value: unknown): null | undefined {
	if (value === null || value === undefined) return null;
	if (typeof value === "boolean") return value ? undefined : null;
	if (typeof value === "number") return value === 0 ? null : undefined;
	if (typeof value === "string") {
		const lowercase = value.toLowerCase();
		if (lowercase === "undefined" || lowercase === "null" || value === "" || value === "0") return null;
	}
	return undefined;
}

/**
 * Coerces a value the way TypeBox's `Value.Convert` does.
 *
 * TypeBox tags its schemas with a `~kind` marker and converts by that marker, so a schema
 * without one (a serialized plain JSON schema) is left alone. The conversion mutates
 * objects in place, like TypeBox's own converter does.
 */
function convertTypeBoxValue(value: unknown, schema: JsonSchemaObject): unknown {
	switch (getTypeBoxKind(schema)) {
		case "String":
			return tryString(value) ?? value;
		case "Number": {
			const numeric = tryNumber(value);
			return numeric === undefined ? value : numeric;
		}
		case "Integer": {
			const numeric = tryNumber(value);
			return numeric === undefined ? value : Math.trunc(numeric);
		}
		case "Boolean":
			return tryBoolean(value) ?? value;
		case "Null":
			return tryNull(value) ?? value;
		case "Object":
			if (!isPlainObject(value)) return value;
			convertObjectProperties(value, schema);
			return value;
		case "Record":
			if (!isPlainObject(value)) return value;
			convertPatternProperties(value, schema);
			return value;
		case "Array": {
			const items = Array.isArray(schema.items) ? undefined : schema.items;
			const source = Array.isArray(value) ? value : [value];
			return source.map((item) => (items ? convertTypeBoxValue(item, items) : item));
		}
		case "Union":
			return convertUnionValue(value, schema);
		case "Literal": {
			if (value === schema.const) return value;
			const converted = convertLiteralValue(value, schema.const);
			return converted === schema.const ? converted : value;
		}
		case "Enum": {
			const arms = (schema.enum ?? []).map((allowed) => ({
				const: allowed,
				"~kind": "Literal",
			})) as JsonSchemaObject[];
			return convertUnionValue(value, { anyOf: arms } as JsonSchemaObject);
		}
		default:
			return value;
	}
}

/** The `~kind` marker TypeBox puts on the schemas it built. */
function getTypeBoxKind(schema: JsonSchemaObject): string | undefined {
	const kind = schema["~kind"];
	return typeof kind === "string" ? kind : undefined;
}

function convertLiteralValue(value: unknown, literal: unknown): unknown {
	if (typeof literal === "string") return tryString(value) ?? value;
	if (typeof literal === "number") return tryNumber(value) ?? value;
	if (typeof literal === "boolean") return tryBoolean(value) ?? value;
	return value;
}

function convertUnionValue(value: unknown, schema: JsonSchemaObject): unknown {
	const arms = schema.anyOf ?? [];
	if (arms.some((arm) => collectSchemaErrors(value, arm, "").length === 0)) {
		return value;
	}
	for (const arm of arms) {
		const candidate = convertTypeBoxValue(structuredClone(value), arm);
		if (collectSchemaErrors(candidate, arm, "").length === 0) {
			return candidate;
		}
	}
	return value;
}

function convertObjectProperties(value: Record<string, unknown>, schema: JsonSchemaObject): void {
	const properties = schema.properties ?? {};
	const required = new Set(schema.required ?? []);
	for (const [key, propertySchema] of Object.entries(properties)) {
		if (!(key in value)) continue;
		const entryValue = value[key];
		if (entryValue === undefined && !required.has(key)) continue;
		value[key] = convertTypeBoxValue(entryValue, propertySchema);
	}
	const additional = schema.additionalProperties;
	if (isPlainObject(additional)) {
		for (const [key, entryValue] of Object.entries(value)) {
			if (key in properties) continue;
			value[key] = convertTypeBoxValue(entryValue, additional);
		}
	}
}

function convertPatternProperties(value: Record<string, unknown>, schema: JsonSchemaObject): void {
	for (const [pattern, propertySchema] of Object.entries(schema.patternProperties ?? {})) {
		for (const [key, entryValue] of Object.entries(value)) {
			if (!matchesPattern(pattern, key)) continue;
			value[key] = convertTypeBoxValue(entryValue, propertySchema);
		}
	}
}

// --------------------------------------------------------------------------
// Coercion of plain JSON schemas
// --------------------------------------------------------------------------

function coercePrimitiveByType(value: unknown, type: string): unknown {
	switch (type) {
		case "number": {
			if (value === null) {
				return 0;
			}
			if (typeof value === "string" && value.trim() !== "") {
				const parsed = Number(value);
				if (Number.isFinite(parsed)) {
					return parsed;
				}
			}
			if (typeof value === "boolean") {
				return value ? 1 : 0;
			}
			return value;
		}
		case "integer": {
			if (value === null) {
				return 0;
			}
			if (typeof value === "string" && value.trim() !== "") {
				const parsed = Number(value);
				if (Number.isInteger(parsed)) {
					return parsed;
				}
			}
			if (typeof value === "boolean") {
				return value ? 1 : 0;
			}
			return value;
		}
		case "boolean": {
			if (value === null) {
				return false;
			}
			if (typeof value === "string") {
				if (value === "true") {
					return true;
				}
				if (value === "false") {
					return false;
				}
			}
			if (typeof value === "number") {
				if (value === 1) {
					return true;
				}
				if (value === 0) {
					return false;
				}
			}
			return value;
		}
		case "string": {
			if (value === null) {
				return "";
			}
			if (typeof value === "number" || typeof value === "boolean") {
				return String(value);
			}
			return value;
		}
		case "null": {
			if (value === "" || value === 0 || value === false) {
				return null;
			}
			return value;
		}
		default:
			return value;
	}
}

function applySchemaObjectCoercion(value: Record<string, unknown>, schema: JsonSchemaObject): void {
	const properties = schema.properties;
	const definedKeys = new Set<string>(properties ? Object.keys(properties) : []);

	if (properties) {
		for (const [key, propertySchema] of Object.entries(properties)) {
			if (!(key in value)) {
				continue;
			}
			value[key] = coerceWithJsonSchema(value[key], propertySchema);
		}
	}

	if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
		for (const [key, propertyValue] of Object.entries(value)) {
			if (definedKeys.has(key)) {
				continue;
			}
			value[key] = coerceWithJsonSchema(propertyValue, schema.additionalProperties);
		}
	}
}

function applySchemaArrayCoercion(value: unknown[], schema: JsonSchemaObject): void {
	if (Array.isArray(schema.items)) {
		for (let index = 0; index < value.length; index++) {
			const itemSchema = schema.items[index];
			if (!itemSchema) {
				continue;
			}
			value[index] = coerceWithJsonSchema(value[index], itemSchema);
		}
		return;
	}

	if (schema.items && typeof schema.items === "object") {
		for (let index = 0; index < value.length; index++) {
			value[index] = coerceWithJsonSchema(value[index], schema.items);
		}
	}
}

function coerceWithUnionSchema(value: unknown, schemas: JsonSchemaObject[]): unknown {
	for (const schema of schemas) {
		if (collectSchemaErrors(value, schema, "").length === 0) {
			return value;
		}
	}

	for (const schema of schemas) {
		const candidate = structuredClone(value);
		const coerced = coerceWithJsonSchema(candidate, schema);
		if (collectSchemaErrors(coerced, schema, "").length === 0) {
			return coerced;
		}
	}
	return value;
}

function coerceWithJsonSchema(value: unknown, schema: JsonSchemaObject): unknown {
	let nextValue = value;

	if (Array.isArray(schema.allOf)) {
		for (const nested of schema.allOf) {
			nextValue = coerceWithJsonSchema(nextValue, nested);
		}
	}

	if (Array.isArray(schema.anyOf)) {
		nextValue = coerceWithUnionSchema(nextValue, schema.anyOf);
	}

	if (Array.isArray(schema.oneOf)) {
		nextValue = coerceWithUnionSchema(nextValue, schema.oneOf);
	}

	const schemaTypes = getSchemaTypes(schema);
	const matchesUnionMember =
		schemaTypes.length > 1 && schemaTypes.some((schemaType) => matchesJsonType(nextValue, schemaType));
	if (schemaTypes.length > 0 && !matchesUnionMember) {
		for (const schemaType of schemaTypes) {
			const candidate = coercePrimitiveByType(nextValue, schemaType);
			if (candidate !== nextValue) {
				nextValue = candidate;
				break;
			}
		}
	}

	if (
		schemaTypes.includes("object") &&
		typeof nextValue === "object" &&
		nextValue !== null &&
		!Array.isArray(nextValue)
	) {
		applySchemaObjectCoercion(nextValue as Record<string, unknown>, schema);
	}

	if (schemaTypes.includes("array") && Array.isArray(nextValue)) {
		applySchemaArrayCoercion(nextValue, schema);
	}

	return nextValue;
}

function normalizeOptionalNulls(value: unknown, schema: JsonSchemaObject): void {
	if (Array.isArray(value)) {
		if (Array.isArray(schema.items)) {
			for (let index = 0; index < value.length; index++) {
				const itemSchema = schema.items[index];
				if (itemSchema) normalizeOptionalNulls(value[index], itemSchema);
			}
		} else if (schema.items) {
			for (const item of value) normalizeOptionalNulls(item, schema.items);
		}
		return;
	}
	if (typeof value !== "object" || value === null || !schema.properties) return;

	const object = value as Record<string, unknown>;
	const required = new Set(schema.required ?? []);
	for (const [key, propertySchema] of Object.entries(schema.properties)) {
		if (!(key in object)) continue;
		if (
			object[key] === null &&
			!required.has(key) &&
			typeof (propertySchema as { $ref?: unknown }).$ref !== "string" &&
			collectSchemaErrors(null, propertySchema, "").length > 0
		) {
			delete object[key];
		} else {
			normalizeOptionalNulls(object[key], propertySchema);
		}
	}
}

/**
 * Finds a tool by name and validates the tool call arguments against its schema
 * @param tools Array of tool definitions
 * @param toolCall The tool call from the LLM
 * @returns The validated arguments
 * @throws Error if tool is not found or validation fails
 */
export function validateToolCall(tools: Tool[], toolCall: ToolCall): any {
	const tool = tools.find((t) => t.name === toolCall.name);
	if (!tool) {
		throw new Error(`Tool "${toolCall.name}" not found`);
	}
	return validateToolArguments(tool, toolCall);
}

/**
 * Validates tool call arguments against the tool's schema
 * @param tool The tool definition with the schema
 * @param toolCall The tool call from the LLM
 * @returns The validated (and potentially coerced) arguments
 * @throws Error with formatted message if validation fails
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
	if (toolCall.argumentsError) {
		throw new Error(`Invalid arguments for tool "${toolCall.name}": ${toolCall.argumentsError}`);
	}
	const args = structuredClone(toolCall.arguments);
	const schema = tool.parameters as JsonSchemaObject;
	normalizeOptionalNulls(args, schema);

	const isTypeBoxSchema = Object.getOwnPropertySymbols(tool.parameters).includes(TYPEBOX_KIND);
	// TypeBox's own conversion runs first and coerces the values it recognizes; the plain
	// JSON schema coercion then has the last word on the properties it reaches.
	const converted = convertTypeBoxValue(args, schema);
	if (converted !== args && isPlainObject(converted) && isPlainObject(args)) {
		for (const key of Object.keys(args)) {
			delete args[key];
		}
		Object.assign(args, converted);
	}
	if (!isTypeBoxSchema) {
		const coerced = coerceWithJsonSchema(args, schema);
		if (coerced !== args) {
			if (isPlainObject(coerced) && isPlainObject(args)) {
				for (const key of Object.keys(args)) {
					delete args[key];
				}
				Object.assign(args, coerced);
			} else {
				return collectSchemaErrors(coerced, schema, "").length === 0 ? coerced : args;
			}
		}
	}

	const errors = collectSchemaErrors(args, schema, "");
	if (errors.length === 0) {
		return args;
	}

	const errorText =
		errors.map((error) => `  - ${formatValidationPath(error)}: ${error.message}`).join("\n") ||
		"Unknown validation error";

	const errorMessage = `Validation failed for tool "${toolCall.name}":\n${errorText}\n\nReceived arguments:\n${JSON.stringify(toolCall.arguments, null, 2)}`;

	throw new Error(errorMessage);
}
