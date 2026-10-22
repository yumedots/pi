/**
 * The state of the client that comes from the server.
 *
 * The server owns the session: the directory it works in, the theme it renders with and
 * the settings it runs on. The client draws with that state, so it mirrors it. This module
 * is the seam between the two: it holds the manifest of the server, it installs the theme
 * and the settings mirror, and it refuses to start when the extensions of the two sides do
 * not match.
 */

import type { PiManifest } from "@earendil-works/pi-server/client";
import { ClientSettings } from "./client-settings.ts";
import { setThemeFromJson, type Theme } from "./client-theme.ts";
import { assertManifestMatches, collectClientExtensions, type PiExtensionInfo } from "./manifest-check.ts";

/** The options of {@link ClientState}. */
export interface ClientStateOptions {
	/** The manifest of the server. */
	readonly manifest: PiManifest;
	/** The agent directory of the client. */
	readonly agentDir: string;
	/** Whether the project of the server is trusted. */
	readonly projectTrusted?: boolean;
}

/**
 * The state of the client that comes from the server.
 */
export class ClientState {
	/** The manifest of the server. */
	readonly manifest: PiManifest;
	/** The working directory of the server. */
	readonly cwd: string;
	/** The mirror of the settings of the server. */
	readonly settings: ClientSettings;
	private readonly agentDir: string;

	constructor(options: ClientStateOptions) {
		this.manifest = options.manifest;
		this.cwd = options.manifest.cwd;
		this.agentDir = options.agentDir;
		this.settings = new ClientSettings({
			scopes: {
				global: options.manifest.settingsScopes?.global ?? {},
				project: options.manifest.settingsScopes?.project ?? {},
			},
			projectTrusted: options.projectTrusted,
		});
	}

	/**
	 * Install the theme of the server as the theme of the client.
	 */
	installTheme(): Theme {
		return setThemeFromJson(this.manifest.theme.json);
	}

	/**
	 * The extension files the client has on its own disk.
	 */
	clientExtensions(): PiExtensionInfo[] {
		return collectClientExtensions({
			cwd: this.cwd,
			agentDir: this.agentDir,
			configuredPaths: this.settings.getExtensionPaths(),
		});
	}

	/**
	 * Check the extensions of the client against the manifest of the server.
	 *
	 * @throws {ManifestMismatchError} when the two sides do not match.
	 */
	assertExtensionsMatch(): void {
		assertManifestMatches(this.clientExtensions(), this.manifest);
	}
}
