/**
 * The `node:module` module the extensions import.
 *
 * The embedded host loads an extension's own files, so it has no module
 * loader to hand out. The names exist so that a module that imports them
 * loads; using them throws.
 */

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const createRequire = unavailable("createRequire");
export const Module = unavailable("Module");
export const isBuiltin = (name: string): boolean =>
	name.startsWith("node:") || ["fs", "path", "os", "url", "events", "module"].includes(name);

export default { createRequire, Module, isBuiltin };
