/**
 * The `node:sqlite` module the extensions import.
 *
 * The embedded host has no database: the names exist so that a module that
 * imports them loads, and opening one throws.
 */

export class DatabaseSync {
	constructor(_path: string, _options?: unknown) {
		throw new Error("node:sqlite is not available in the embedded extension host");
	}
}

export default { DatabaseSync };
