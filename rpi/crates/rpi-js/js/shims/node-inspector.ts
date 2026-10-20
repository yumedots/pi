/**
 * The `node:inspector` module the extensions import.
 *
 * The embedded host has no such facility: the names exist so that a
 * module that imports them loads.
 */

export const open = (_target?: unknown): never => {
	throw new Error("node:inspector is not available in the embedded extension host");
};
export const close = (): void => undefined;
export default { open, close };
