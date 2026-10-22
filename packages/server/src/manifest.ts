/**
 * The manifest of a running server.
 *
 * The client is a renderer: it draws what the server tells it to draw. The manifest is
 * how the server describes itself to the client: the extensions it loaded, the theme it
 * renders with, the settings it runs on, the commands it offers and the keys it binds.
 *
 * The client compares the extensions of the manifest with its own list and refuses to
 * start when the two do not match, so the digest of every extension file is part of it.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { type AgentSession, BUILTIN_SLASH_COMMANDS, type SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Extension } from "@earendil-works/pi-coding-agent/core/extensions/types";
import { KeybindingsManager } from "@earendil-works/pi-coding-agent/core/keybindings";
import {
	getAvailableThemesWithPaths,
	getTerminalTheme,
	resolveSystemThemeName,
	resolveThemeSetting,
	SYSTEM_THEME_NAME,
} from "@earendil-works/pi-coding-agent/core/theme/theme";
import { stripBom } from "@earendil-works/pi-coding-agent/utils/text";

/** What the server tells the client about itself. */
export interface PiManifest {
	/** The server version. */
	version: string;
	/** The server's own working directory: the directory the sessions are created in. */
	cwd: string;
	/** The extensions the server loaded. */
	extensions: Array<{ path: string; side: "client" | "server" | "both"; hash: string }>;
	/** The theme the server uses: the theme name and its parsed JSON. */
	theme: { name: string; json: unknown };
	/** The themes the server offers: the name and the parsed JSON of each one. */
	themes: Array<{ name: string; json: unknown }>;
	/** The settings the server uses. */
	settings: Record<string, unknown>;
	/** The settings of the server, per scope: the global ones and the project ones. */
	settingsScopes: { global: Record<string, unknown>; project: Record<string, unknown> };
	/** The slash commands the server offers. */
	commands: Array<{ name: string; description?: string }>;
	/** The keybindings the server uses: action id to key list. */
	keybindings: Record<string, string[]>;
}

/** How many characters of the digest of an extension file the manifest carries. */
const HASH_LENGTH = 12;

/**
 * The version the manifest reports.
 *
 * The server knows its version, so it can set it; until then the version of the package
 * is the version of the server.
 */
let serverVersion = readPackageVersion();

/**
 * Report another version in the manifest.
 *
 * The server starts with a version of its own, which can differ from the version of the
 * package it was built from.
 */
export function setServerVersion(version: string): void {
	serverVersion = version;
}

/** The version the manifest reports. */
export function getServerVersion(): string {
	return serverVersion;
}

/** The options of {@link buildManifest}. */
export interface BuildManifestOptions {
	/** The version of the server. */
	version: string;
	/** The server's own working directory: the directory the sessions are created in. */
	cwd: string;
	/** The session the manifest is about. */
	session: AgentSession;
	/** The settings manager the session runs on. */
	settingsManager: SettingsManager;
	/** The keybindings the server binds. Defaults to the keybindings of the agent directory. */
	keybindings?: KeybindingsManager;
}

/**
 * Build the manifest of a session.
 *
 * Everything in it comes from the server's own state: the extensions it loaded, the
 * theme it renders with, the settings it runs on, the commands it offers and the keys it
 * binds.
 */
export function buildManifest(options: BuildManifestOptions): PiManifest {
	const { version, cwd, session, settingsManager } = options;
	return {
		version,
		cwd,
		extensions: manifestExtensions(session),
		theme: manifestTheme(session, settingsManager),
		themes: manifestThemes(session),
		settings: settingsManager.getSettings() as unknown as Record<string, unknown>,
		settingsScopes: {
			global: settingsManager.getGlobalSettings() as unknown as Record<string, unknown>,
			project: settingsManager.getProjectSettings() as unknown as Record<string, unknown>,
		},
		commands: manifestCommands(session),
		keybindings: manifestKeybindings(options.keybindings),
	};
}

/**
 * The themes the server offers.
 *
 * The theme picker of the terminal UI needs the list, and the themes belong to the
 * server: it reads them and it sends their documents.
 */
function manifestThemes(session: AgentSession): PiManifest["themes"] {
	const themes: PiManifest["themes"] = [];
	for (const theme of session.resourceLoader.getThemes().themes) {
		if (!theme.name) continue;
		themes.push({ name: theme.name, json: readThemeDocument(theme.sourcePath) });
	}
	for (const theme of getAvailableThemesWithPaths()) {
		if (themes.some((entry) => entry.name === theme.name)) continue;
		themes.push({ name: theme.name, json: readThemeDocument(theme.path) });
	}
	return themes;
}

/**
 * The document of a theme, as the theme module reads it.
 */
function readThemeDocument(path: string | undefined): unknown {
	if (!path) return {};
	try {
		return JSON.parse(stripBom(readFileSync(path, "utf-8"))) as unknown;
	} catch {
		return {};
	}
}

/**
 * The extensions the server loaded, with the side they declare.
 *
 * The server reads every extension file, also the ones it does not run on its own side,
 * because the client compares its own list with this one: an extension the client has
 * and the server does not, or the other way round, keeps the client from starting.
 */
function manifestExtensions(session: AgentSession): PiManifest["extensions"] {
	return loadedExtensions(session).map((extension) => ({
		path: extension.resolvedPath || extension.path,
		side: extension.side,
		hash: hashFile(extension.resolvedPath),
	}));
}

/**
 * Every extension the server loaded, including the ones it skipped on its own side.
 */
function loadedExtensions(session: AgentSession): Extension[] {
	const loader = session.resourceLoader;
	const byPath = new Map<string, Extension>();
	for (const extension of loader.getExtensions().extensions) {
		byPath.set(extension.path, extension);
	}
	for (const side of ["client", "server"] as const) {
		for (const extension of loader.getExtensionsBySide?.(side) ?? []) {
			byPath.set(extension.path, extension);
		}
	}
	return [...byPath.values()];
}

/**
 * The digest of a file, as the manifest carries it.
 *
 * The digest is the first twelve hex characters of the sha256 of the file content, the
 * shape the release scripts use. A file that cannot be read has no digest.
 */
export function hashFile(path: string): string {
	try {
		return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, HASH_LENGTH);
	} catch {
		return "";
	}
}

/**
 * The theme the server renders with.
 *
 * The name is the theme the settings name, resolved the way the theme module resolves
 * it: the system theme follows the terminal of the server, an automatic theme follows
 * the terminal as well. The JSON is the file of that theme, so the client draws with the
 * same colors the server draws with.
 */
function manifestTheme(session: AgentSession, settingsManager: SettingsManager): PiManifest["theme"] {
	const requested = resolveThemeSetting(settingsManager.getThemeSetting(), getTerminalTheme()) ?? SYSTEM_THEME_NAME;
	const name = requested === SYSTEM_THEME_NAME ? resolveSystemThemeName() : requested;
	return { name, json: readThemeJson(session, name) };
}

/**
 * The JSON of a theme, as the theme module reads it.
 *
 * The theme of the session comes first: it is the one the session renders with. The
 * themes of the theme module are the fallback for the built-in ones.
 */
function readThemeJson(session: AgentSession, name: string): unknown {
	const loaded = session.resourceLoader.getThemes().themes.find((theme) => theme.name === name);
	const path = loaded?.sourcePath ?? themeFilePath(name);
	return readThemeDocument(path);
}

/**
 * The file of a theme, as the theme module finds it.
 */
function themeFilePath(name: string): string | undefined {
	try {
		return getAvailableThemesWithPaths().find((theme) => theme.name === name)?.path;
	} catch {
		return undefined;
	}
}

/**
 * The commands the server offers: the built-in ones and the ones of the extensions.
 */
function manifestCommands(session: AgentSession): PiManifest["commands"] {
	const commands: PiManifest["commands"] = [];
	for (const command of BUILTIN_SLASH_COMMANDS) {
		commands.push({ name: command.name, description: command.description });
	}
	for (const command of session.extensionRunner.getRegisteredCommands()) {
		commands.push({ name: command.invocationName, description: command.description });
	}
	return commands;
}

/**
 * The keys the server binds: every action and the keys it answers to.
 */
function manifestKeybindings(keybindings: KeybindingsManager | undefined): Record<string, string[]> {
	const resolved = (keybindings ?? KeybindingsManager.create()).getResolvedBindings();
	const result: Record<string, string[]> = {};
	for (const [action, keys] of Object.entries(resolved)) {
		if (keys === undefined) {
			result[action] = [];
			continue;
		}
		result[action] = Array.isArray(keys) ? [...keys] : [keys];
	}
	return result;
}

/**
 * The version of the server package.
 */
function readPackageVersion(): string {
	try {
		const requirePackage = createRequire(import.meta.url);
		const manifest = requirePackage("@earendil-works/pi-server/package.json") as { version?: string };
		if (manifest.version) return manifest.version;
	} catch {
		// The package is not resolvable from here: the file next to the module is.
	}
	try {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
			version?: string;
		};
		if (manifest.version) return manifest.version;
	} catch {
		// There is no package file: the version stays unknown.
	}
	return "0.0.0";
}
