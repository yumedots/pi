/**
 * The error of an import that names a file that does not exist.
 *
 * It lives in a module of its own so that a client can recognize it without loading the
 * agent runtime and with it the whole model catalog.
 */
export class SessionImportFileNotFoundError extends Error {
	readonly filePath: string;

	constructor(filePath: string) {
		super(`File not found: ${filePath}`);
		this.name = "SessionImportFileNotFoundError";
		this.filePath = filePath;
	}
}
