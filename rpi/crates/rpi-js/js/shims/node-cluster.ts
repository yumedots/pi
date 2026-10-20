/**
 * The `node:cluster` module the extensions import.
 *
 * The embedded host has no such facility: the names exist so that a
 * module that imports them loads.
 */

export const isPrimary = true;
export const fork = (): never => {
	throw new Error("node:cluster is not available in the embedded extension host");
};
export const on = (_event: string, _listener: (...args: unknown[]) => void): void => undefined;
export default { isPrimary, fork, on };
