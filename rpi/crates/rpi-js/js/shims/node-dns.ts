/**
 * The `node:dns` module the extensions import.
 *
 * The embedded host has no such facility: the names exist so that a
 * module that imports them loads.
 */

export const lookup = (_hostname: string, _options?: unknown, _callback?: unknown): void => undefined;
export const resolve = (_hostname: string, _callback?: unknown): void => undefined;
export const promises = { lookup: async () => ({ address: "127.0.0.1", family: 4 }) };
export default { lookup, resolve, promises };
