/**
 * The `node:module` module the extensions import.
 *
 * The embedded host has no module loader: an extension's own files are loaded
 * by the extension host. The names exist so that a module that imports them
 * loads.
 */

import fs from "./node-fs.ts";
import path from "./node-path.ts";

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

/// The modules a `require` can answer with.
///
/// A bundled package creates a require at module scope and uses it right
/// away — pi's image library looks for its WASM file that way — so a require
/// that throws when it is *obtained* takes the whole extension host down. The
/// require answers for the modules the host has, and throws only when it is
/// used for something it does not.
export const createRequire = (_from?: string): ((id: string) => unknown) => (id: string) => {
	if (id === "fs" || id === "node:fs") return fs;
	if (id === "path" || id === "node:path") return path;
	return unavailable("require")(id);
};

export const Module = unavailable("Module");

export const isBuiltin = (name: string): boolean =>
	name.startsWith("node:") || ["fs", "path", "os", "url", "events", "module"].includes(name);

export default { createRequire, Module, isBuiltin };
