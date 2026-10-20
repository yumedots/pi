/**
 * The `node:dgram` module the extensions import.
 *
 * The embedded host has no such facility: the names exist so that a
 * module that imports them loads.
 */

export const createSocket = (_type?: string): never => {
	throw new Error("node:dgram is not available in the embedded extension host");
};
export default { createSocket };
