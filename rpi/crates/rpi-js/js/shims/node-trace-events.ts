/**
 * The `node:trace_events` module the extensions import.
 *
 * The embedded host has no such facility: the names exist so that a
 * module that imports them loads.
 */

export const categories = (): string[] => [];
export const start = (): void => undefined;
export const stop = (): void => undefined;
export default { categories, start, stop };
