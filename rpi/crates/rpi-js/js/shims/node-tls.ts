/**
 * The `node:tls` module the extensions import.
 *
 * The embedded host does not open TLS sockets: the names exist so that a
 * module that imports them loads.
 */

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const connect = unavailable("connect");
export const createSecureContext = unavailable("createSecureContext");

export class TLSSocket {
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

export default { connect, createSecureContext, TLSSocket };
