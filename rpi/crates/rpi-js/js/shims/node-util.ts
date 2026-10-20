/**
 * The `node:util` module the extensions import.
 *
 * The names exist with the behaviour pi's code needs: `format` interpolates
 * `%s`/`%d`/`%j`/`%o`/`%O`/`%%`, and `promisify` turns a callback function
 * into a promise-returning one.
 */

export const format = (first: unknown, ...rest: unknown[]): string => {
	if (typeof first !== "string") {
		return [first, ...rest].map((value) => String(value)).join(" ");
	}
	let index = 0;
	const formatted = first.replace(/%[sdjioO%]/g, (token) => {
		if (token === "%%") return "%";
		if (index >= rest.length) return token;
		const value = rest[index++];
		switch (token) {
			case "%s":
				return typeof value === "string" ? value : String(value);
			case "%d":
				return String(Number(value));
			case "%j":
				try {
					return JSON.stringify(value) ?? "undefined";
				} catch {
					return "[Circular]";
				}
			default:
				return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
		}
	});
	const trailing = rest.slice(index).map((value) => String(value));
	return trailing.length > 0 ? `${formatted} ${trailing.join(" ")}` : formatted;
};

export const promisify = <T>(
	fn: (...args: unknown[]) => unknown,
): ((...args: unknown[]) => Promise<T>) =>
	(...args: unknown[]) =>
		new Promise<T>((resolve, reject) => {
			fn(...args, (error: unknown, value: T) => {
				if (error) reject(error);
				else resolve(value);
			});
		});

export const inspect = (value: unknown): string => {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
};

export const deprecate = <T extends (...args: never[]) => unknown>(fn: T): T => fn;

export const types = {
	isDate: (value: unknown): boolean => value instanceof Date,
	isRegExp: (value: unknown): boolean => value instanceof RegExp,
	isPromise: (value: unknown): boolean =>
		typeof value === "object" && value !== null && "then" in value,
};

export const parseArgs = (options: unknown): { values: Record<string, unknown> } => {
	const spec = (options ?? {}) as { options?: Record<string, { type?: string }> };
	const values: Record<string, unknown> = {};
	for (const [name, option] of Object.entries(spec.options ?? {})) {
		if (option?.type === "boolean") values[name] = false;
	}
	return { values };
};

export default { format, promisify, inspect, deprecate, types, parseArgs };
