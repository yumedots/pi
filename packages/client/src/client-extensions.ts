/**
 * The extensions the client has on disk.
 *
 * Pi runs in two processes: the server owns the agent runtime and the client renders.
 * An extension declares the side it needs with `pi.setSide()`, but the client does not
 * run any of them: the server loads the extensions and draws what only an extension can
 * draw.
 *
 * The client still has to know which extension files sit on its own disk, with the
 * digest of their content: the two sides have to agree, or the client refuses to start
 * against a server it would not behave like.
 */

import { discoverClientExtensionPaths } from "./client-support/extension-discovery.ts";
import { extensionFileHash } from "./manifest-check.ts";

/** An extension file the client has on disk. */
export interface ClientExtensionFile {
	/** Where the extension file is. */
	readonly path: string;
	/** The digest of the content of the file. */
	readonly hash: string;
}

/**
 * The extension files the client has on disk.
 *
 * The discovery is the one of the runtime: the same directories, the same rules for a
 * directory, the same entry points of a package. Nothing is executed, so the client does
 * not pay for a transpiler.
 */
export function discoverClientExtensionFiles(options: {
	/** The working directory of the server. */
	cwd: string;
	/** The agent directory of the client. */
	agentDir: string;
	/** The extension paths of the settings of the server. */
	configuredPaths?: readonly string[];
}): ClientExtensionFile[] {
	return discoverClientExtensionPaths(options).map((path) => ({ path, hash: extensionFileHash(path) }));
}
