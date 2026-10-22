/**
 * The settings of the client.
 *
 * The settings belong to the server: it reads them, it applies them and it writes them.
 * The client keeps a mirror of them, because it draws with them: the theme, the sidebar,
 * the output padding, the nerd fonts. The mirror is fed by the manifest of the server.
 *
 * A setting the user changes in the terminal UI is a change of the server's settings: the
 * client hands it to the server and mirrors the answer.
 */

import { randomUUID } from "node:crypto";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Transport } from "@earendil-works/pi-ai";
import type { CacheWarmingMode, WarningSettings } from "@earendil-works/pi-coding-agent/core/settings-manager";
import type { TerminalCapabilities } from "@earendil-works/pi-tui";
import { SETTINGS_DEFAULTS } from "./client-support/settings-defaults.ts";

/** The quiet startup modes of the client. */
export type QuietStartup = boolean | "header";

/** The trust policy of the project. */
export type DefaultProjectTrust = "ask" | "always" | "never";

/** The transport of the session. */
export type TransportSetting = Transport;

/** Where a shared session goes. */
export type SessionShareDestination = "auto" | "gist" | "radius";

/** The mode of the terminal UI. */
export type TuiMode = "regular" | "fullscreen";

/** What the escape key does twice. */
export type DoubleEscapeAction = "fork" | "tree" | "none";

/** How the tree of the session is filtered. */
export type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

/** How the terminal UI leaves the fullscreen mode. */
export type FullscreenExitOutput = "resume-hint" | "transcript";

/** The scrollbar of the fullscreen mode. */
export type ScrollViewScrollbar = "auto" | "always" | "hidden";

/** Where the autocomplete list sits. */
export type AutocompletePosition = "above" | "below";

/** How the mermaid diagrams are rendered. */
export type MermaidRenderingMode = "streaming" | "final" | "off";

/** The settings as the server sends them: a flat record. */
export type ServerSettings = Record<string, unknown>;

/** The scope of a setting: the global one or the one of the project. */
export type SettingsScope = "global" | "project";

/** The options of {@link ClientSettings}. */
export interface ClientSettingsOptions {
	/** The settings of the server: the global ones and the project ones. */
	scopes?: { global?: ServerSettings; project?: ServerSettings };
	/** Whether the project of the server is trusted. */
	projectTrusted?: boolean;
	/**
	 * Called when the user changes a setting.
	 *
	 * The server applies the change; the client mirrors it.
	 */
	onChange?: (key: string, value: unknown, scope: SettingsScope) => void | Promise<void>;
}

/** A setting path of the record, like "terminal.showImages". */
function readPath(settings: ServerSettings, path: string): unknown {
	let current: unknown = settings;
	for (const part of path.split(".")) {
		if (typeof current !== "object" || current === null) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

/** Write a value at a path of the record, creating the objects on the way. */
function writePath(settings: ServerSettings, path: string, value: unknown): void {
	const parts = path.split(".");
	let current = settings;
	for (const part of parts.slice(0, -1)) {
		const next = current[part];
		if (typeof next !== "object" || next === null) {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	current[parts[parts.length - 1]] = value;
}

/**
 * The settings of the client.
 *
 * Every getter reads the mirror of the server's settings, every setter changes the
 * mirror and tells the server about the change.
 */
export class ClientSettings {
	private global: ServerSettings;
	private project: ServerSettings;
	private merged: ServerSettings;
	private trusted: boolean;
	private readonly onChange: ((key: string, value: unknown, scope: SettingsScope) => void | Promise<void>) | undefined;
	private deviceId: string | undefined;

	constructor(options: ClientSettingsOptions = {}) {
		this.global = { ...(options.scopes?.global ?? {}) };
		this.project = { ...(options.scopes?.project ?? {}) };
		this.merged = { ...this.global, ...this.project };
		this.trusted = options.projectTrusted ?? true;
		this.onChange = options.onChange;
	}

	/** The settings of the server, as the client mirrors them. */
	getSettings(): ServerSettings {
		return this.merged;
	}

	/** The global settings of the server. */
	getGlobalSettings(): ServerSettings {
		return this.global;
	}

	/** The project settings of the server. */
	getProjectSettings(): ServerSettings {
		return this.project;
	}

	/** Whether the project of the server is trusted. */
	isProjectTrusted(): boolean {
		return this.trusted;
	}

	/** Record the trust decision of the server. */
	setProjectTrusted(trusted: boolean): void {
		this.trusted = trusted;
	}

	/** The theme as it was configured, which may name a light and a dark theme. */
	getThemeSetting(): string | undefined {
		const value = this.merged.theme;
		return typeof value === "string" ? value : undefined;
	}

	/** The theme the server renders with. */
	getTheme(): string | undefined {
		const theme = this.getThemeSetting();
		return theme?.includes("/") ? undefined : theme;
	}

	getDefaultProvider(): string | undefined {
		const value = this.merged.defaultProvider;
		return typeof value === "string" ? value : undefined;
	}

	getDefaultModel(): string | undefined {
		const value = this.merged.defaultModel;
		return typeof value === "string" ? value : undefined;
	}

	getDefaultThinkingLevel(): ThinkingLevel | undefined {
		return this.merged.defaultThinkingLevel as ThinkingLevel | undefined;
	}

	getSteeringMode(): "all" | "one-at-a-time" {
		return (this.merged.steeringMode as "all" | "one-at-a-time") ?? SETTINGS_DEFAULTS.steeringMode;
	}

	getFollowUpMode(): "all" | "one-at-a-time" {
		return (this.merged.followUpMode as "all" | "one-at-a-time") ?? SETTINGS_DEFAULTS.followUpMode;
	}

	getTransport(): TransportSetting {
		const value = this.merged.transport;
		return value === "sse" || value === "websocket" || value === "websocket-cached"
			? value
			: SETTINGS_DEFAULTS.transport;
	}

	getSessionShareDestination(): SessionShareDestination {
		return this.merged.sessionShareDestination === "gist" || this.merged.sessionShareDestination === "radius"
			? this.merged.sessionShareDestination
			: SETTINGS_DEFAULTS.sessionShareDestination;
	}

	getCacheWarmingMode(): CacheWarmingMode {
		return this.merged.cacheWarming === "off" || this.merged.cacheWarming === "idle"
			? this.merged.cacheWarming
			: SETTINGS_DEFAULTS.cacheWarming;
	}

	getShowSessionSidebar(): boolean {
		return (this.merged.showSessionSidebar as boolean) ?? SETTINGS_DEFAULTS.showSessionSidebar;
	}

	getServerIdleTimeoutMs(): number {
		const value = readPath(this.merged, "server.idleTimeoutMs");
		return typeof value === "number" && value >= 0 ? value : SETTINGS_DEFAULTS.server.idleTimeoutMs;
	}

	getHttpIdleTimeoutMs(): number {
		const value = this.merged.httpIdleTimeoutMs;
		return typeof value === "number" && value >= 0 ? value : 300_000;
	}

	getHideThinkingBlock(): boolean {
		return (this.merged.hideThinkingBlock as boolean) ?? SETTINGS_DEFAULTS.hideThinkingBlock;
	}

	getShowCacheMissNotices(): boolean {
		return (this.merged.showCacheMissNotices as boolean) ?? SETTINGS_DEFAULTS.showCacheMissNotices;
	}

	getNerdFonts(): boolean {
		return (this.merged.nerdFonts as boolean) ?? SETTINGS_DEFAULTS.nerdFonts;
	}

	getThreeDEmptySession(): boolean {
		return (this.merged.threeDEmptySession as boolean) ?? SETTINGS_DEFAULTS.threeDEmptySession;
	}

	getExternalEditorCommand(): string {
		const configured = this.merged.externalEditor;
		if (typeof configured === "string" && configured.trim() !== "") return configured;
		const environmentEditor = process.env.VISUAL || process.env.EDITOR;
		if (environmentEditor) return environmentEditor;
		return process.platform === "win32" ? "notepad" : "nano";
	}

	getQuietStartup(): QuietStartup {
		const value = this.merged.quietStartup;
		return value === true || value === "header" ? value : SETTINGS_DEFAULTS.quietStartup;
	}

	getDefaultProjectTrust(): DefaultProjectTrust {
		const value = this.merged.defaultProjectTrust;
		return value === "always" || value === "never" ? value : SETTINGS_DEFAULTS.defaultProjectTrust;
	}

	getCollapseChangelog(): boolean {
		return (this.merged.collapseChangelog as boolean) ?? SETTINGS_DEFAULTS.collapseChangelog;
	}

	getEnableSkillCommands(): boolean {
		return (this.merged.enableSkillCommands as boolean) ?? SETTINGS_DEFAULTS.enableSkillCommands;
	}

	getEnabledModels(): string[] | undefined {
		const value = this.merged.enabledModels;
		return Array.isArray(value) ? (value as string[]) : undefined;
	}

	getTerminalCapabilityOverrides(): Partial<TerminalCapabilities> {
		const terminal = (this.merged.terminal ?? {}) as Record<string, unknown>;
		const images = terminal.images;
		return {
			...(images === "kitty" || images === "iterm2" ? { images } : images === false ? { images: null } : {}),
			...(typeof terminal.trueColor === "boolean" ? { trueColor: terminal.trueColor } : {}),
			...(typeof terminal.hyperlinks === "boolean" ? { hyperlinks: terminal.hyperlinks } : {}),
		};
	}

	getShowImages(): boolean {
		const value = readPath(this.merged, "terminal.showImages");
		return (value as boolean) ?? SETTINGS_DEFAULTS.terminal.showImages;
	}

	getImageWidthCells(): number {
		const value = readPath(this.merged, "terminal.imageWidthCells");
		if (typeof value !== "number" || !Number.isFinite(value)) return SETTINGS_DEFAULTS.terminal.imageWidthCells;
		return Math.max(1, Math.floor(value));
	}

	getClearOnShrink(): boolean {
		const value = readPath(this.merged, "terminal.clearOnShrink");
		if (value !== undefined) return value as boolean;
		if (process.env.PI_CLEAR_ON_SHRINK === "1") return true;
		return SETTINGS_DEFAULTS.terminal.clearOnShrink;
	}

	getShowTerminalProgress(): boolean {
		const value = readPath(this.merged, "terminal.showTerminalProgress");
		return (value as boolean) ?? SETTINGS_DEFAULTS.terminal.showTerminalProgress;
	}

	getImageAutoResize(): boolean {
		const value = readPath(this.merged, "images.autoResize");
		return (value as boolean) ?? SETTINGS_DEFAULTS.images.autoResize;
	}

	getBlockImages(): boolean {
		const value = readPath(this.merged, "images.blockImages");
		return (value as boolean) ?? SETTINGS_DEFAULTS.images.blockImages;
	}

	getTuiMode(): TuiMode {
		return this.merged.tuiMode === "regular" ? "regular" : SETTINGS_DEFAULTS.tuiMode;
	}

	getFullscreenExitOutput(): FullscreenExitOutput {
		return this.merged.fullscreenExitOutput === "transcript" ? "transcript" : SETTINGS_DEFAULTS.fullscreenExitOutput;
	}

	getFullscreenScrollbar(): ScrollViewScrollbar {
		const mode = this.merged.fullscreenScrollbar;
		return mode === "always" || mode === "hidden" ? mode : SETTINGS_DEFAULTS.fullscreenScrollbar;
	}

	getFullscreenCopyOnSelect(): boolean {
		return (this.merged.fullscreenCopyOnSelect as boolean) ?? SETTINGS_DEFAULTS.fullscreenCopyOnSelect;
	}

	getFullscreenWheelScrollLines(): number | "auto" {
		const lines = this.merged.fullscreenWheelScrollLines;
		if (lines === "auto") return "auto";
		if (typeof lines === "number" && Number.isFinite(lines)) {
			return Math.max(1, Math.min(100, Math.floor(lines)));
		}
		return SETTINGS_DEFAULTS.fullscreenWheelScrollLines;
	}

	getOutputPad(): 0 | 1 {
		const value = this.merged.outputPad;
		return value === 0 || value === 1 ? value : SETTINGS_DEFAULTS.outputPad;
	}

	getEditorPaddingX(): number {
		const value = this.merged.editorPaddingX;
		return typeof value === "number" && Number.isFinite(value) ? value : SETTINGS_DEFAULTS.editorPaddingX;
	}

	getAutocompleteMaxVisible(): number {
		const value = this.merged.autocompleteMaxVisible;
		return typeof value === "number" && Number.isFinite(value) ? value : SETTINGS_DEFAULTS.autocompleteMaxVisible;
	}

	getAutocompletePosition(): AutocompletePosition {
		return this.merged.autocompletePosition === "below" ? "below" : SETTINGS_DEFAULTS.autocompletePosition;
	}

	getCodeBlockIndent(): string {
		const value = readPath(this.merged, "markdown.codeBlockIndent");
		return typeof value === "string" ? value : SETTINGS_DEFAULTS.markdown.codeBlockIndent;
	}

	getMermaidRenderingMode(): MermaidRenderingMode {
		const value = readPath(this.merged, "markdown.mermaid");
		return value === "final" || value === "off" ? value : SETTINGS_DEFAULTS.markdown.mermaid;
	}

	getWarnings(): WarningSettings {
		const value = this.merged.warnings;
		return typeof value === "object" && value !== null ? (value as WarningSettings) : SETTINGS_DEFAULTS.warnings;
	}

	getTreeFilterMode(): TreeFilterMode {
		const value = this.merged.treeFilterMode;
		return value === "no-tools" || value === "user-only" || value === "labeled-only" || value === "all"
			? value
			: SETTINGS_DEFAULTS.treeFilterMode;
	}

	getDoubleEscapeAction(): DoubleEscapeAction {
		const value = this.merged.doubleEscapeAction;
		return value === "fork" || value === "none" ? value : SETTINGS_DEFAULTS.doubleEscapeAction;
	}

	/**
	 * Whether the terminal shows its cursor while the editor positions it.
	 *
	 * The server keeps the setting at the top level, the client sends it with the key of
	 * the terminal group, so both places are read.
	 */
	getShowHardwareCursor(): boolean {
		const value = readPath(this.merged, "terminal.showHardwareCursor") ?? this.merged.showHardwareCursor;
		return typeof value === "boolean" ? value : process.env.PI_HARDWARE_CURSOR === "1";
	}

	/**
	 * The id of the device of the user.
	 *
	 * The server owns the id: the client reads it from the settings of the server and
	 * only makes one up when the server has none yet.
	 */
	getOrCreateDeviceId(): string {
		const value = this.merged.deviceId;
		if (typeof value === "string" && value.length > 0) return value;
		this.deviceId ??= randomUUID();
		return this.deviceId;
	}

	getLastChangelogVersion(): string | undefined {
		const value = this.merged.lastChangelogVersion;
		return typeof value === "string" ? value : undefined;
	}

	getBranchSummarySkipPrompt(): boolean {
		return (
			(readPath(this.merged, "branchSummary.skipPrompt") as boolean) ?? SETTINGS_DEFAULTS.branchSummary.skipPrompt
		);
	}

	getModelThinkingLevel(provider: string, modelId: string): ThinkingLevel | undefined {
		const levels = this.merged.modelThinkingLevels;
		if (typeof levels !== "object" || levels === null) return undefined;
		return (levels as Record<string, ThinkingLevel>)[`${provider}/${modelId}`];
	}

	getAllModelThinkingLevels(): Record<string, ThinkingLevel> {
		const levels = this.merged.modelThinkingLevels;
		if (typeof levels !== "object" || levels === null) return {};
		return { ...(levels as Record<string, ThinkingLevel>) };
	}

	getPackages(): unknown[] {
		const value = this.merged.packages;
		return Array.isArray(value) ? value : [];
	}

	getExtensionPaths(): string[] {
		return this.pathList("extensions");
	}

	getSkillPaths(): string[] {
		return this.pathList("skills");
	}

	getPromptTemplatePaths(): string[] {
		return this.pathList("prompts");
	}

	getThemePaths(): string[] {
		return this.pathList("themes");
	}

	getSessionDir(): string | undefined {
		const value = this.merged.sessionDir;
		return typeof value === "string" ? value : undefined;
	}

	/** The changes the client sent to the server and that are not answered yet. */
	private pending: Promise<void>[] = [];

	/**
	 * Wait until the changes the client made reached the server.
	 *
	 * The server owns the settings: it applies them and tells the client what it made of
	 * them. The client keeps its mirror in step.
	 */
	async flush(): Promise<void> {
		await Promise.all(this.pending.splice(0));
	}

	/**
	 * Change a setting.
	 *
	 * The mirror changes right away, so the terminal UI draws the new value; the server
	 * is told about the change right away too.
	 */
	set(key: string, value: unknown, scope: SettingsScope = "global"): void {
		const target = scope === "project" ? this.project : this.global;
		writePath(target, key, value);
		writePath(this.merged, key, value);
		this.pending.push(this.notify(key, value, scope));
	}

	/**
	 * Tell the server about a change.
	 *
	 * A server that refuses the change does not break the terminal UI: the mirror keeps
	 * the value the user picked.
	 */
	private notify(key: string, value: unknown, scope: SettingsScope): Promise<void> {
		try {
			return Promise.resolve(this.onChange?.(key, value, scope)).then(
				() => undefined,
				() => undefined,
			);
		} catch {
			return Promise.resolve();
		}
	}

	setTheme(theme: string): void {
		this.set("theme", theme);
	}

	setThemeSetting(theme: string): void {
		this.set("theme", theme);
	}

	setShowSessionSidebar(value: boolean): void {
		this.set("showSessionSidebar", value);
	}

	setHideThinkingBlock(value: boolean): void {
		this.set("hideThinkingBlock", value);
	}

	setShowCacheMissNotices(value: boolean): void {
		this.set("showCacheMissNotices", value);
	}

	setNerdFonts(value: boolean): void {
		this.set("nerdFonts", value);
	}

	setThreeDEmptySession(value: boolean): void {
		this.set("threeDEmptySession", value);
	}

	setQuietStartup(value: QuietStartup): void {
		this.set("quietStartup", value);
	}

	setCollapseChangelog(value: boolean): void {
		this.set("collapseChangelog", value);
	}

	setOutputPad(value: 0 | 1): void {
		this.set("outputPad", value);
	}

	setEditorPaddingX(value: number): void {
		this.set("editorPaddingX", value);
	}

	setAutocompleteMaxVisible(value: number): void {
		this.set("autocompleteMaxVisible", value);
	}

	setAutocompletePosition(value: AutocompletePosition): void {
		this.set("autocompletePosition", value);
	}

	setTreeFilterMode(value: TreeFilterMode): void {
		this.set("treeFilterMode", value);
	}

	setDoubleEscapeAction(value: DoubleEscapeAction): void {
		this.set("doubleEscapeAction", value);
	}

	setTuiMode(value: TuiMode): void {
		this.set("tuiMode", value);
	}

	setFullscreenExitOutput(value: FullscreenExitOutput): void {
		this.set("fullscreenExitOutput", value);
	}

	setFullscreenScrollbar(value: ScrollViewScrollbar): void {
		this.set("fullscreenScrollbar", value);
	}

	setFullscreenCopyOnSelect(value: boolean): void {
		this.set("fullscreenCopyOnSelect", value);
	}

	setFullscreenWheelScrollLines(value: number | "auto"): void {
		this.set("fullscreenWheelScrollLines", value);
	}

	setShowImages(value: boolean): void {
		this.set("terminal.showImages", value);
	}

	setImageWidthCells(value: number): void {
		this.set("terminal.imageWidthCells", value);
	}

	setImageAutoResize(value: boolean): void {
		this.set("images.autoResize", value);
	}

	setBlockImages(value: boolean): void {
		this.set("images.blockImages", value);
	}

	setShowTerminalProgress(value: boolean): void {
		this.set("terminal.showTerminalProgress", value);
	}

	setClearOnShrink(value: boolean): void {
		this.set("terminal.clearOnShrink", value);
	}

	setShowHardwareCursor(value: boolean): void {
		this.set("terminal.showHardwareCursor", value);
	}

	setMermaidRenderingMode(value: MermaidRenderingMode): void {
		this.set("markdown.mermaid", value);
	}

	setCodeBlockIndent(value: string): void {
		this.set("markdown.codeBlockIndent", value);
	}

	setServerIdleTimeoutMs(value: number): void {
		this.set("server.idleTimeoutMs", value);
	}

	setHttpIdleTimeoutMs(value: number): void {
		this.set("httpIdleTimeoutMs", value);
	}

	setDefaultProjectTrust(value: DefaultProjectTrust): void {
		this.set("defaultProjectTrust", value);
	}

	setTransport(value: TransportSetting): void {
		this.set("transport", value);
	}

	setSessionShareDestination(value: SessionShareDestination): void {
		this.set("sessionShareDestination", value);
	}

	setCacheWarmingMode(value: CacheWarmingMode): void {
		this.set("cacheWarming", value);
	}

	setEnableSkillCommands(value: boolean): void {
		this.set("enableSkillCommands", value);
	}

	setEnabledModels(value: string[] | undefined): void {
		this.set("enabledModels", value);
	}

	setDefaultProvider(provider: string): void {
		this.set("defaultProvider", provider);
	}

	setDefaultModel(modelId: string): void {
		this.set("defaultModel", modelId);
	}

	setDefaultModelAndProvider(provider: string, modelId: string): void {
		this.set("defaultProvider", provider);
		this.set("defaultModel", modelId);
	}

	setDefaultThinkingLevel(level: ThinkingLevel): void {
		this.set("defaultThinkingLevel", level);
	}

	setModelThinkingLevel(provider: string, modelId: string, level: ThinkingLevel): void {
		const levels = { ...this.getAllModelThinkingLevels() };
		levels[`${provider}/${modelId}`] = level;
		this.set("modelThinkingLevels", levels);
	}

	removeModelThinkingLevel(provider: string, modelId: string): void {
		const levels = { ...this.getAllModelThinkingLevels() };
		delete levels[`${provider}/${modelId}`];
		this.set("modelThinkingLevels", levels);
	}

	setLastChangelogVersion(version: string): void {
		this.set("lastChangelogVersion", version);
	}

	setWarnings(warnings: WarningSettings): void {
		this.set("warnings", warnings);
	}

	setPackages(packages: unknown[]): void {
		this.set("packages", packages);
	}

	setProjectPackages(packages: unknown[]): void {
		this.set("packages", packages, "project");
	}

	setExtensionPaths(paths: string[]): void {
		this.set("extensions", paths);
	}

	setProjectExtensionPaths(paths: string[]): void {
		this.set("extensions", paths, "project");
	}

	setSkillPaths(paths: string[]): void {
		this.set("skills", paths);
	}

	setProjectSkillPaths(paths: string[]): void {
		this.set("skills", paths, "project");
	}

	setPromptTemplatePaths(paths: string[]): void {
		this.set("prompts", paths);
	}

	setProjectPromptTemplatePaths(paths: string[]): void {
		this.set("prompts", paths, "project");
	}

	setThemePaths(paths: string[]): void {
		this.set("themes", paths);
	}

	setProjectThemePaths(paths: string[]): void {
		this.set("themes", paths, "project");
	}

	private pathList(key: string): string[] {
		const value = this.merged[key];
		return Array.isArray(value) ? (value as string[]) : [];
	}
}
