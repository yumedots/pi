/**
 * The `node:worker_threads` module the extensions import.
 *
 * The embedded host runs on one thread: there is no worker. The names exist
 * so that a module that imports them loads; using them throws.
 */

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const Worker = unavailable("Worker");
export const parentPort = null;
export const workerData = null;
export const isMainThread = true;
export const threadId = 0;

export default { Worker, parentPort, workerData, isMainThread, threadId };
