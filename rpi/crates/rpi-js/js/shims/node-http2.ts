/**
 * The `node:http2` module the extensions import.
 *
 * The embedded host has no such facility: the names exist so that a
 * module that imports them loads.
 */

export const connect = (_authority: string, _options?: unknown): never => {
	throw new Error("node:http2 is not available in the embedded extension host");
};
export const createServer = (): never => {
	throw new Error("node:http2 is not available in the embedded extension host");
};
export default { connect, createServer };
