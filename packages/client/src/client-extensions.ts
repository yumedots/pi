/**
 * The extensions the client loads.
 *
 * Pi runs in two processes: the server owns the agent runtime and the client renders. An
 * extension declares the side it needs with `pi.setSide()`:
 *
 * - `"client"`: the extension only renders. The client loads it, the server skips it.
 * - `"server"`: the extension only provides tools and behaviour. The server loads it.
 * - `"both"`: the extension needs both sides, so it has to be installed on both of them.
 *
 * The client loads the extensions from its own directories (the project `.pi/extensions` and
 * the agent directory), the same way the server does, and keeps the ones it can use. The
 * server-only extensions are skipped: that is the expected outcome, not a problem, so the
 * client does not report them.
 *
 * The client never runs the event handlers or the tools of an extension: those belong to the
 * server. The client only uses what an extension contributes to the rendering.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent/core/diagnostics";
import type { Extension, ExtensionSide, InlineExtension } from "@earendil-works/pi-coding-agent/core/extensions/types";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent/core/resource-loader";
import { SettingsManager } from "@earendil-works/pi-coding-agent/core/settings-manager";
import { loadThemeFromPath, type Theme } from "@earendil-works/pi-coding-agent/core/theme/theme";

/** An extension the client knows about. */
export interface ClientExtensionInfo {
	/** Where the extension comes from. */
	readonly path: string;
	/** The side the extension declared. */
	readonly side: ExtensionSide;
}

/** The options of {@link loadClientExtensions}. */
export interface ClientExtensionLoadOptions {
	/** The working directory of the session. */
	readonly cwd: string;
	/** The agent directory of the client. */
	readonly agentDir: string;
	/** The settings of the client. One is created when it is omitted. */
	readonly settingsManager?: SettingsManager;
	/** Extensions that are loaded in addition to the ones of the directories. */
	readonly extensionFactories?: InlineExtension[];
}

/** The extensions the client loaded. */
export interface ClientExtensionLoadResult {
	/** The extensions the client can use. */
	readonly extensions: Extension[];
	/** The extensions the client skipped because they declared the server side. */
	readonly skipped: ClientExtensionInfo[];
	/** The errors of the load. */
	readonly errors: ReadonlyArray<{ path: string; error: string }>;
	/** The warnings of the load. The skipped server-side extensions are not among them. */
	readonly warnings: ReadonlyArray<{ path: string; warning: string }>;
	/** The themes the extensions ship. */
	readonly themes: Theme[];
	/** The diagnostics of the load. */
	readonly diagnostics: ResourceDiagnostic[];
}

/**
 * The theme files an extension ships.
 *
 * An extension puts its themes next to its entry point: `theme.json` or `themes/*.json`. The
 * client registers them, so they can be picked in the theme selector.
 */
function discoverExtensionThemes(extension: Extension): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
	const themes: Theme[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	const entry = extension.resolvedPath || extension.path;
	if (!entry) return { themes, diagnostics };
	const directory = dirname(entry);
	const candidates: string[] = [];

	const themesDirectory = join(directory, "themes");
	if (existsSync(themesDirectory) && statSync(themesDirectory).isDirectory()) {
		for (const file of readdirSync(themesDirectory).sort()) {
			if (file.endsWith(".json")) candidates.push(join(themesDirectory, file));
		}
	}
	const singleTheme = join(directory, "theme.json");
	if (existsSync(singleTheme)) candidates.push(singleTheme);

	for (const candidate of candidates) {
		try {
			themes.push(loadThemeFromPath(candidate));
		} catch (error) {
			diagnostics.push({
				type: "error",
				message: `Failed to load theme: ${error instanceof Error ? error.message : String(error)}`,
				path: candidate,
			});
		}
	}
	return { themes, diagnostics };
}

/**
 * The warning the resource loader emits for an extension it skipped on this side.
 *
 * The client skips the extensions that declare the server side, and that is the expected
 * outcome: they run on the server. The warning is not a problem, so the client drops it.
 */
const SKIPPED_EXTENSION_WARNING = /^Extension declares side ".*" and was skipped on the .* side/;

/**
 * Whether a warning of the load is about an extension the client skipped.
 *
 * Such an extension declares the server side and runs on the server. The client has nothing
 * to render with it, which is the expected outcome and not a problem.
 */
function isSkippedExtensionWarning(
	warning: { path: string; warning: string },
	skippedPaths: ReadonlySet<string>,
): boolean {
	if (SKIPPED_EXTENSION_WARNING.test(warning.warning)) return true;
	return skippedPaths.has(warning.path) && /skipped/i.test(warning.warning);
}

/**
 * Load the extensions the client can use.
 *
 * The loader skips the extensions that declare the server side. Those extensions run on the
 * server, so the client does not report them as an issue.
 */
export async function loadClientExtensions(options: ClientExtensionLoadOptions): Promise<ClientExtensionLoadResult> {
	const settingsManager = options.settingsManager ?? SettingsManager.create(options.cwd, options.agentDir);
	const loader = new DefaultResourceLoader({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager,
		extensionSide: "client",
		extensionFactories: options.extensionFactories,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();

	const loaded = loader.getExtensions();
	const extensions = loader.getExtensionsBySide("client");
	const skipped: ClientExtensionInfo[] = loader
		.getExtensionsBySide("server")
		.filter((extension) => extension.side === "server")
		.map((extension) => ({ path: extension.path, side: extension.side }));

	const themes: Theme[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	for (const extension of extensions) {
		const found = discoverExtensionThemes(extension);
		themes.push(...found.themes);
		diagnostics.push(...found.diagnostics);
	}

	const skippedPaths = new Set(skipped.map((extension) => extension.path));
	return {
		extensions,
		skipped,
		errors: loaded.errors,
		warnings: (loaded.warnings ?? []).filter((warning) => !isSkippedExtensionWarning(warning, skippedPaths)),
		themes,
		diagnostics,
	};
}
