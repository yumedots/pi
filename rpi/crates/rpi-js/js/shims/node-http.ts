/**
 * The `node:http` module the extensions import.
 *
 * The embedded host does not serve HTTP: the names exist so that a module
 * that imports them loads, and using them throws.
 */

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const createServer = unavailable("createServer");
export const request = unavailable("request");
export const get = unavailable("get");

export default { createServer, request, get };
