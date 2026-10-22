/**
 * The configuration of the coding agent.
 *
 * The configuration is shared with the client: the paths of the agent directory, the name
 * of the application and the version come from the package.json of the package that owns
 * the running code, and that is this package.
 */

import {
	createPackageIdentity,
	findNodePackageDir,
	isBunBinary,
	isBundledNode,
} from "@earendil-works/pi-support/config";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { dirname } from "path";
import { fileURLToPath } from "url";

export * from "@earendil-works/pi-support/config";

const identity = createPackageIdentity(findNodePackageDir(dirname(fileURLToPath(import.meta.url))));

export const {
	PACKAGE_NAME,
	APP_NAME,
	APP_TITLE,
	CONFIG_DIR_NAME,
	VERSION,
	ENV_AGENT_DIR,
	ENV_SESSION_DIR,
	getPackageDir,
	getThemesDir,
	getExportTemplateDir,
	getPackageJsonPath,
	getReadmePath,
	getDocsPath,
	getExamplesPath,
	getChangelogPath,
	getAgentDir,
	getCustomThemesDir,
	getModelsPath,
	getAuthPath,
	getSettingsPath,
	getToolsDir,
	getBinDir,
	getPromptsDir,
	getSessionsDir,
	getDebugLogPath,
	getSelfInstallManifestPath,
	readSelfInstallManifest,
	detectInstallChange,
	getSelfUpdateOwner,
} = identity;

let quickJSWasmPath: string | undefined;

/** Called by the Bun entry with the path of the QuickJS wasm file embedded in the compiled executable. */
export function setEmbeddedQuickJSWasmPath(path: string): void {
	quickJSWasmPath = path;
}

/**
 * Get path to `quickjs-wasi/quickjs.wasm`, the VM that runs codemode scripts. Resolved once so the
 * compiled module cached per path keeps working after an update removes this install (#10439).
 */
export function getQuickJSWasmPath(): string {
	quickJSWasmPath ??= createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm");
	return quickJSWasmPath;
}

/** Resolve the codemode worker entry for a release runtime. */
export function resolveCodemodeWorkerSpecifier(
	runtime: "bun-binary" | "bundled-node" | "unbundled",
	moduleUrl: string,
): string | URL | undefined {
	// Bun embeds explicit source entrypoints, but on Windows Bun 1.3 cannot map an absolute
	// B:\~BUN URL back to one. A relative string with the original source extension works on
	// every Bun platform.
	if (runtime === "bun-binary") return "./src/extensions/codemode/worker.ts";
	if (runtime === "bundled-node") return new URL("./codemode-worker.js", moduleUrl);
	return undefined;
}

let codemodeWorkerDataUrl: URL | undefined;

/**
 * Get the codemode worker entry, or undefined to use the worker that ships next to pi-codemode.
 * The Bun and Node release builds both pass the worker as an extra entrypoint.
 */
export function getCodemodeWorkerSpecifier(): string | URL | undefined {
	const runtime = isBunBinary ? "bun-binary" : isBundledNode ? "bundled-node" : "unbundled";
	const specifier = resolveCodemodeWorkerSpecifier(runtime, import.meta.url);
	if (runtime !== "bundled-node" || !(specifier instanceof URL)) return specifier;
	// Spawn workers from an in-memory copy. An update replaces or deletes the file while this
	// process keeps running (#10439). The bundle build keeps the worker free of relative imports
	// and import.meta, so it runs from a data: URL.
	codemodeWorkerDataUrl ??= new URL(`data:text/javascript;base64,${readFileSync(specifier).toString("base64")}`);
	return codemodeWorkerDataUrl;
}
