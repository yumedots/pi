/**
 * TUI session selector for --resume flag
 */

import type { SessionInfo } from "@earendil-works/pi-coding-agent/core/session-manager";
import type { PiServerClient } from "@earendil-works/pi-server/client";
import { setKeybindings } from "@earendil-works/pi-tui";
import type { ClientSettings } from "../client-settings.ts";
import { KeybindingsManager } from "../client-support/keybindings.ts";
import { SessionMenuComponent } from "../components/session-menu.ts";
import { createStartupTui, startStartupTui } from "./startup-ui.ts";

/**
 * The sessions of the server, as the session menu draws them.
 *
 * The sessions belong to the server, so the client asks it for the list of the directory
 * instead of reading the session files itself.
 */
async function listSessions(client: PiServerClient, directory?: string): Promise<SessionInfo[]> {
	const sessions = await client.listSessions(directory);
	return sessions.map((session) => ({
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		...(session.name !== undefined ? { name: session.name } : {}),
		created: new Date(session.created),
		modified: new Date(session.modified),
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
		allMessagesText: "",
	}));
}

/** Show TUI session selector and return selected session path or null if cancelled */
export async function selectSession(
	client: PiServerClient,
	cwd: string,
	settings: ClientSettings,
): Promise<string | null> {
	const ui = await createStartupTui(settings);
	return new Promise((resolve) => {
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		let resolved = false;

		const selector = new SessionMenuComponent({
			currentLoad: () => listSessions(client, cwd),
			allLoad: () => listSessions(client),
			renameSession: async (sessionPath: string, nextName: string | undefined) => {
				const next = (nextName ?? "").trim();
				if (!next) return;
				await client.renameSession(sessionPath, next);
			},
			onSelect: (session) => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(session.path);
				}
			},
			onCancel: () => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(null);
				}
			},
			// The sessions load in the background, so the screen has to be repainted when they arrive.
			onRequestRender: () => ui.requestRender(),
		});

		ui.addChild(selector);
		ui.setFocus(selector);
		startStartupTui(ui, settings);
	});
}
