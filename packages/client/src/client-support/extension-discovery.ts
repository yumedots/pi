/**
 * The extensions the client has on disk.
 *
 * The server loads the extensions; the client does not. It only has to know which
 * extension files sit on its own disk, so it can tell the server that the two sides
 * do not match and refuse to start against a server it would not behave like.
 *
 * The discovery is the discovery of the runtime, without the loading: the same
 * directories, the same rules for a directory, the same entry points of a package.
 * Nothing is executed, so the client does not pay for a transpiler.
 */

import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** The name of the configuration directory of a project. */
const CONFIG_DIR_NAME = ".pi";

/**
 * The extension files of a directory.
 *
 * The rules are the rules of the runtime: a file is an extension when it is a
 * `.ts` or a `.js` file, a directory is an extension when it holds an entry point
 * or a package that declares one. There is no recursion beyond one level.
 */
export function discoverExtensionsInDir(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}

	const discovered: string[] = [];
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
		const entryPath = join(dir, entry.name);
		if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
			discovered.push(entryPath);
			continue;
		}
		if (entry.isDirectory() || entry.isSymbolicLink()) {
			discovered.push(...(resolveExtensionEntries(entryPath) ?? []));
		}
	}

	return discovered;
}

/** Whether a file name is the name of an extension file. */
function isExtensionFile(name: string): boolean {
	return name.endsWith(".ts") || name.endsWith(".js");
}

/**
 * The entry points of a directory that holds an extension.
 *
 * A package that declares its extensions wins over the index file of the
 * directory, the way the runtime resolves it.
 */
function resolveExtensionEntries(dir: string): string[] | null {
	const packageJsonPath = join(dir, "package.json");
	if (existsSync(packageJsonPath)) {
		const manifest = readPiManifest(packageJsonPath);
		if (manifest?.extensions?.length) {
			const entries: string[] = [];
			for (const extensionPath of manifest.extensions) {
				const resolved = resolve(dir, extensionPath);
				if (existsSync(resolved)) entries.push(resolved);
			}
			if (entries.length > 0) return entries;
		}
	}

	const indexTs = join(dir, "index.ts");
	if (existsSync(indexTs)) return [indexTs];
	const indexJs = join(dir, "index.js");
	if (existsSync(indexJs)) return [indexJs];

	return null;
}

/** The extensions a package manifest declares. */
function readPiManifest(packageJsonPath: string): { extensions?: string[] } | null {
	try {
		const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { pi?: { extensions?: unknown } };
		const extensions = parsed.pi?.extensions;
		if (!Array.isArray(extensions)) return null;
		return { extensions: extensions.filter((entry): entry is string => typeof entry === "string") };
	} catch {
		return null;
	}
}

/**
 * The extension files the client has, the way the server would find them.
 *
 * The paths of the settings come first, the way the runtime resolves them: the
 * project directory, the agent directory and the configured paths.
 */
export function discoverClientExtensionPaths(options: {
	/** The working directory of the server. */
	cwd: string;
	/** The agent directory of the client. */
	agentDir: string;
	/** The extension paths of the settings. */
	configuredPaths?: readonly string[];
}): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	const add = (candidates: string[]): void => {
		for (const candidate of candidates) {
			const key = resolve(candidate);
			if (seen.has(key)) continue;
			seen.add(key);
			paths.push(candidate);
		}
	};

	add(discoverExtensionsInDir(join(options.cwd, CONFIG_DIR_NAME, "extensions")));
	add(discoverExtensionsInDir(join(options.agentDir, "extensions")));

	for (const configured of options.configuredPaths ?? []) {
		if (!configured) continue;
		const resolved = resolve(options.cwd, configured);
		if (!existsSync(resolved)) continue;
		if (statSync(resolved).isDirectory()) {
			const entries = resolveExtensionEntries(resolved);
			add(entries ?? discoverExtensionsInDir(resolved));
			continue;
		}
		add([resolved]);
	}

	return paths;
}
