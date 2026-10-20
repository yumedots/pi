/**
 * The `node:vm` module the extensions import.
 *
 * The embedded host evaluates an extension's own code and nothing else: the
 * names exist so that a module that imports them loads.
 */

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const runInThisContext = unavailable("runInThisContext");
export const createContext = unavailable("createContext");
export const compileFunction = unavailable("compileFunction");

export class Script {
	constructor(_code: string) {}
	runInThisContext(): never {
		throw new Error("node:vm is not available in the embedded extension host");
	}
}

export default { runInThisContext, createContext, compileFunction, Script };
