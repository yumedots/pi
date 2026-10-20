/**
 * The `node:assert` module the extensions import.
 *
 * The names exist with the behaviour pi's code needs: the equality checks
 * throw an `AssertionError` when they fail, and `throws` reports whether the
 * function threw.
 */

export class AssertionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AssertionError";
	}
}

const fail = (message: string): never => {
	throw new AssertionError(message);
};

const show = (value: unknown): string => {
	try {
		return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
};

export const ok = (value: unknown, message?: string): void => {
	if (!value) fail(message ?? `expected a truthy value, got ${show(value)}`);
};

export const strictEqual = (actual: unknown, expected: unknown, message?: string): void => {
	if (actual !== expected) {
		fail(message ?? `expected ${show(expected)}, got ${show(actual)}`);
	}
};

export const notStrictEqual = (actual: unknown, expected: unknown, message?: string): void => {
	if (actual === expected) fail(message ?? `expected a value other than ${show(expected)}`);
};

export const deepStrictEqual = (actual: unknown, expected: unknown, message?: string): void => {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		fail(message ?? `expected ${show(expected)}, got ${show(actual)}`);
	}
};

export const notDeepStrictEqual = (actual: unknown, expected: unknown, message?: string): void => {
	if (JSON.stringify(actual) === JSON.stringify(expected)) {
		fail(message ?? `expected a value other than ${show(expected)}`);
	}
};

export const match = (value: string, pattern: RegExp, message?: string): void => {
	if (!pattern.test(value)) fail(message ?? `expected ${show(value)} to match ${pattern}`);
};

export const throws = (fn: () => unknown, message?: string): unknown => {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return fail(message ?? "expected the function to throw");
};

export const doesNotThrow = (fn: () => unknown, message?: string): void => {
	try {
		fn();
	} catch (error) {
		fail(message ?? `expected the function not to throw, got ${show(error)}`);
	}
};

export const rejects = async (promise: Promise<unknown>, message?: string): Promise<unknown> => {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	return fail(message ?? "expected the promise to reject");
};

export const fail_ = fail;

export default {
	ok,
	strictEqual,
	notStrictEqual,
	deepStrictEqual,
	notDeepStrictEqual,
	match,
	throws,
	doesNotThrow,
	rejects,
	fail: fail_,
	AssertionError,
};
