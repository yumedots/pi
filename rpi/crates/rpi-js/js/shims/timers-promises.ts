/**
 * The `timers/promises` module the extensions import.
 *
 * The embedded host has no event loop, so a timer never fires on its own.
 * The promise resolves when the host's microtask queue is pumped, which is
 * what the runtime does while it waits for a promise to settle.
 */

const immediate = (): Promise<void> => Promise.resolve();

export const setTimeout = (): Promise<void> => immediate();
export const setImmediate = immediate;
export const setInterval = (): Promise<never> =>
	new Promise<never>(() => undefined);

export default { setTimeout, setImmediate, setInterval };
