import type { ResolvedPaths } from "../core/package-manager.ts";
import type { SettingsManager } from "../core/settings-manager.ts";

/**
 * The host of the interactive `pi config` editor.
 *
 * The editor itself is a terminal UI and lives in the client package, which owns the
 * terminal UI. The coding agent only knows the shape of the editor and where the
 * resolved resources come from, so the client registers its implementation here before
 * the command runs. Without a registered editor the command explains that it needs the
 * client instead of failing with an import error.
 */

/** The resolved resources the editor shows, per scope. */
export type ConfigSelectorResolvedPaths = Record<"global" | "project", ResolvedPaths>;

/** The options the editor takes. */
export interface ConfigSelectorOptions {
	/** The resolved resources, per scope. */
	resolvedPaths: ConfigSelectorResolvedPaths;
	/** The settings manager of the command. */
	settingsManager: SettingsManager;
	/** The directory the command runs in. */
	cwd: string;
	/** The agent directory. */
	agentDir: string;
	/** The scope the editor writes to. */
	writeScope: "global" | "project";
	/** Whether the project scope is available. */
	projectModeAvailable: boolean;
}

/** The editor implementation the client registers. */
export type ConfigSelector = (options: ConfigSelectorOptions) => Promise<void>;

let registeredSelector: ConfigSelector | undefined;

/** Register the interactive editor. The client calls this before it runs a command. */
export function setConfigSelector(selector: ConfigSelector | undefined): void {
	registeredSelector = selector;
}

/** The registered editor, if there is one. */
export function getConfigSelector(): ConfigSelector | undefined {
	return registeredSelector;
}
