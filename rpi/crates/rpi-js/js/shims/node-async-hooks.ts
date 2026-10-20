/**
 * The `node:async_hooks` module the extensions import.
 *
 * The embedded host runs on one thread with no async hooks to trace: the
 * names exist so that a module that imports them loads.
 */

export const createHook = () => ({
	enable: () => undefined,
	disable: () => undefined,
});

export const executionAsyncId = (): number => 0;
export const triggerAsyncId = (): number => 0;
export const asyncResource = (): { triggerAsyncId: () => number } => ({
	triggerAsyncId: () => 0,
});
export const executionAsyncResource = () => undefined;
export const AsyncResource = class {
	constructor(_type: string) {}
	runInAsyncScope = <T>(fn: () => T): T => fn();
	emitDestroy = (): void => undefined;
};

export default {
	createHook,
	executionAsyncId,
	triggerAsyncId,
	asyncResource,
	executionAsyncResource,
	AsyncResource,
};
