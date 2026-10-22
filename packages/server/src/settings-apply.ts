/**
 * The settings the client changes.
 *
 * The settings belong to the server: it reads them, it applies them and it writes
 * them. The client draws with them and hands the changes over, so this module is
 * the seam: it takes a key and a value and applies the change to the settings of
 * the server.
 */

import type { SettingsManager } from "@earendil-works/pi-coding-agent";

/** The settings the client is allowed to change. */
export const CLIENT_SETTING_KEYS = [
	"theme",
	"showSessionSidebar",
	"hideThinkingBlock",
	"showCacheMissNotices",
	"nerdFonts",
	"threeDEmptySession",
	"quietStartup",
	"collapseChangelog",
	"outputPad",
	"editorPaddingX",
	"autocompleteMaxVisible",
	"autocompletePosition",
	"treeFilterMode",
	"doubleEscapeAction",
	"tuiMode",
	"fullscreenExitOutput",
	"fullscreenScrollbar",
	"fullscreenCopyOnSelect",
	"fullscreenWheelScrollLines",
	"terminal.showImages",
	"terminal.imageWidthCells",
	"images.autoResize",
	"images.blockImages",
	"terminal.showTerminalProgress",
	"terminal.clearOnShrink",
	"terminal.showHardwareCursor",
	"server.idleTimeoutMs",
	"httpIdleTimeoutMs",
	"defaultProjectTrust",
	"transport",
	"sessionShareDestination",
	"cacheWarming",
	"enableSkillCommands",
	"enabledModels",
	"defaultProvider",
	"defaultModel",
	"defaultThinkingLevel",
	"modelThinkingLevels",
	"lastChangelogVersion",
	"warnings",
	"packages",
	"extensions",
	"skills",
	"prompts",
	"themes",
] as const;

/** A key of the settings the client is allowed to change. */
export type ClientSettingKey = (typeof CLIENT_SETTING_KEYS)[number];

/**
 * Apply a change of the client to the settings of the server.
 *
 * The key is the path the client uses in its mirror of the settings, the value is
 * what the user picked. The change is applied to the scope the client names: the global
 * settings or the settings of the project.
 *
 * @returns whether the key is one the server knows.
 */
export function applyClientSetting(
	settingsManager: SettingsManager,
	key: string,
	value: unknown,
	scope: "global" | "project" = "global",
): boolean {
	switch (key) {
		case "theme":
			if (typeof value !== "string") return false;
			settingsManager.setTheme(value);
			return true;
		case "showSessionSidebar":
			if (typeof value !== "boolean") return false;
			settingsManager.setShowSessionSidebar(value);
			return true;
		case "hideThinkingBlock":
			if (typeof value !== "boolean") return false;
			settingsManager.setHideThinkingBlock(value);
			return true;
		case "showCacheMissNotices":
			if (typeof value !== "boolean") return false;
			settingsManager.setShowCacheMissNotices(value);
			return true;
		case "nerdFonts":
			if (typeof value !== "boolean") return false;
			settingsManager.setNerdFonts(value);
			return true;
		case "threeDEmptySession":
			if (typeof value !== "boolean") return false;
			settingsManager.setThreeDEmptySession(value);
			return true;
		case "quietStartup":
			if (value !== true && value !== false && value !== "header") return false;
			settingsManager.setQuietStartup(value);
			return true;
		case "collapseChangelog":
			if (typeof value !== "boolean") return false;
			settingsManager.setCollapseChangelog(value);
			return true;
		case "outputPad":
			if (value !== 0 && value !== 1) return false;
			settingsManager.setOutputPad(value);
			return true;
		case "editorPaddingX":
			if (typeof value !== "number") return false;
			settingsManager.setEditorPaddingX(value);
			return true;
		case "autocompleteMaxVisible":
			if (typeof value !== "number") return false;
			settingsManager.setAutocompleteMaxVisible(value);
			return true;
		case "autocompletePosition":
			if (value !== "above" && value !== "below") return false;
			settingsManager.setAutocompletePosition(value);
			return true;
		case "treeFilterMode":
			if (!isTreeFilterMode(value)) return false;
			settingsManager.setTreeFilterMode(value);
			return true;
		case "doubleEscapeAction":
			if (value !== "fork" && value !== "tree" && value !== "none") return false;
			settingsManager.setDoubleEscapeAction(value);
			return true;
		case "tuiMode":
			if (value !== "regular" && value !== "fullscreen") return false;
			settingsManager.setTuiMode(value);
			return true;
		case "fullscreenExitOutput":
			if (value !== "resume-hint" && value !== "transcript") return false;
			settingsManager.setFullscreenExitOutput(value);
			return true;
		case "fullscreenScrollbar":
			if (value !== "auto" && value !== "always" && value !== "hidden") return false;
			settingsManager.setFullscreenScrollbar(value);
			return true;
		case "fullscreenCopyOnSelect":
			if (typeof value !== "boolean") return false;
			settingsManager.setFullscreenCopyOnSelect(value);
			return true;
		case "fullscreenWheelScrollLines":
			if (value !== "auto" && (typeof value !== "number" || !Number.isFinite(value))) return false;
			settingsManager.setFullscreenWheelScrollLines(value);
			return true;
		case "terminal.showImages":
			if (typeof value !== "boolean") return false;
			settingsManager.setShowImages(value);
			return true;
		case "terminal.imageWidthCells":
			if (typeof value !== "number") return false;
			settingsManager.setImageWidthCells(value);
			return true;
		case "images.autoResize":
			if (typeof value !== "boolean") return false;
			settingsManager.setImageAutoResize(value);
			return true;
		case "images.blockImages":
			if (typeof value !== "boolean") return false;
			settingsManager.setBlockImages(value);
			return true;
		case "terminal.showTerminalProgress":
			if (typeof value !== "boolean") return false;
			settingsManager.setShowTerminalProgress(value);
			return true;
		case "terminal.clearOnShrink":
			if (typeof value !== "boolean") return false;
			settingsManager.setClearOnShrink(value);
			return true;
		case "terminal.showHardwareCursor":
			if (typeof value !== "boolean") return false;
			settingsManager.setShowHardwareCursor(value);
			return true;
		case "server.idleTimeoutMs":
			if (typeof value !== "number") return false;
			settingsManager.setServerIdleTimeoutMs(value);
			return true;
		case "httpIdleTimeoutMs":
			if (typeof value !== "number") return false;
			settingsManager.setHttpIdleTimeoutMs(value);
			return true;
		case "defaultProjectTrust":
			if (value !== "ask" && value !== "always" && value !== "never") return false;
			settingsManager.setDefaultProjectTrust(value);
			return true;
		case "transport":
			if (value !== "sse" && value !== "websocket") return false;
			settingsManager.setTransport(value);
			return true;
		case "sessionShareDestination":
			if (value !== "auto" && value !== "gist" && value !== "radius") return false;
			settingsManager.setSessionShareDestination(value);
			return true;
		case "cacheWarming":
			if (value !== "off" && value !== "streaming" && value !== "idle") return false;
			settingsManager.setCacheWarmingMode(value);
			return true;
		case "enableSkillCommands":
			if (typeof value !== "boolean") return false;
			settingsManager.setEnableSkillCommands(value);
			return true;
		case "enabledModels":
			if (value !== undefined && !Array.isArray(value)) return false;
			settingsManager.setEnabledModels(value as string[] | undefined);
			return true;
		case "defaultProvider":
			if (typeof value !== "string") return false;
			settingsManager.setDefaultProvider(value);
			return true;
		case "defaultModel":
			if (typeof value !== "string") return false;
			settingsManager.setDefaultModel(value);
			return true;
		case "defaultThinkingLevel":
			if (typeof value !== "string") return false;
			settingsManager.setDefaultThinkingLevel(value as Parameters<SettingsManager["setDefaultThinkingLevel"]>[0]);
			return true;
		case "modelThinkingLevels":
			return applyModelThinkingLevels(settingsManager, value);
		case "lastChangelogVersion":
			if (typeof value !== "string") return false;
			settingsManager.setLastChangelogVersion(value);
			return true;
		case "warnings":
			if (typeof value !== "object" || value === null) return false;
			settingsManager.setWarnings(value as Parameters<SettingsManager["setWarnings"]>[0]);
			return true;
		case "packages":
			if (!Array.isArray(value)) return false;
			if (scope === "project") {
				settingsManager.setProjectPackages(value as Parameters<SettingsManager["setProjectPackages"]>[0]);
				return true;
			}
			settingsManager.setPackages(value as Parameters<SettingsManager["setPackages"]>[0]);
			return true;
		case "extensions":
			if (!Array.isArray(value)) return false;
			if (scope === "project") {
				settingsManager.setProjectExtensionPaths(value as string[]);
				return true;
			}
			settingsManager.setExtensionPaths(value as string[]);
			return true;
		case "skills":
			if (!Array.isArray(value)) return false;
			if (scope === "project") {
				settingsManager.setProjectSkillPaths(value as string[]);
				return true;
			}
			settingsManager.setSkillPaths(value as string[]);
			return true;
		case "prompts":
			if (!Array.isArray(value)) return false;
			if (scope === "project") {
				settingsManager.setProjectPromptTemplatePaths(value as string[]);
				return true;
			}
			settingsManager.setPromptTemplatePaths(value as string[]);
			return true;
		case "themes":
			if (!Array.isArray(value)) return false;
			if (scope === "project") {
				settingsManager.setProjectThemePaths(value as string[]);
				return true;
			}
			settingsManager.setThemePaths(value as string[]);
			return true;
		default:
			return false;
	}
}

/** Whether a value names a way of filtering the tree. */
function isTreeFilterMode(value: unknown): value is Parameters<SettingsManager["setTreeFilterMode"]>[0] {
	return (
		value === "default" ||
		value === "no-tools" ||
		value === "user-only" ||
		value === "labeled-only" ||
		value === "all"
	);
}

/**
 * Apply the thinking levels of the models.
 *
 * The client sends the whole record, the server writes one level at a time.
 */
function applyModelThinkingLevels(settingsManager: SettingsManager, value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	for (const [key, level] of Object.entries(value as Record<string, unknown>)) {
		const separator = key.indexOf("/");
		if (separator <= 0) return false;
		settingsManager.setModelThinkingLevel(
			key.slice(0, separator),
			key.slice(separator + 1),
			level as Parameters<SettingsManager["setModelThinkingLevel"]>[2],
		);
	}
	return true;
}
