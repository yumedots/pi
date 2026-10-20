/**
 * The `node:diagnostics_channel` module the extensions import.
 *
 * The embedded host has no diagnostics channel: the names exist so that a
 * module that imports them loads.
 */

export const channel = (_name: string) => ({
	subscribe: () => () => undefined,
	publish: () => undefined,
	hasSubscribers: () => false,
});

export const subscribe = (_name: string, _listener: (message: unknown, name: string) => void) => () => undefined;
export const publish = (_name: string, _message?: unknown): boolean => false;
export const hasSubscribers = (_name: string): boolean => false;

export default { channel, subscribe, publish, hasSubscribers };
