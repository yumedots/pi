/**
 * The `node:timers` module the extensions import.
 *
 * The embedded host has no event loop: the names exist so that a module that
 * imports them loads.
 */

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const setTimeout = unavailable("setTimeout");
export const setInterval = unavailable("setInterval");
export const setImmediate = unavailable("setImmediate");

export default { setTimeout, setInterval, setImmediate };
