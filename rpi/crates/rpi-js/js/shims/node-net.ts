/**
 * The `node:net` module the extensions import.
 *
 * The embedded host does not open sockets: the names exist so that a module
 * that imports them loads.
 */

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const createServer = unavailable("createServer");
export const connect = unavailable("connect");
export const createConnection = unavailable("createConnection");

export class Socket {
	constructor(_options?: unknown) {}
	on(_event: string, _listener: (...args: unknown[]) => void): this {
		return this;
	}
	end(): this {
		return this;
	}
	destroy(): this {
		return this;
	}
}

export default { createServer, connect, createConnection, Socket };
