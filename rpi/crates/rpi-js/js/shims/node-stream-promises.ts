/**
 * The `node:stream/promises` module the extensions import.
 *
 * The embedded host has no streams: the names exist so that a module that
 * imports them loads, and using them throws.
 */

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const pipeline = unavailable("pipeline");
export const finished = unavailable("finished");
export const readableToWeb = unavailable("readableToWeb");

export default { pipeline, finished, readableToWeb };
